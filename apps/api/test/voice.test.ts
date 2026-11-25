// Offline tests for speech to text: the service (with a fake transcriber) and requireJson.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { Store } from '@app/db';
import {
  DEFAULT_SPEECH_MODEL,
  DEFAULT_SPEECH_VOICE,
  speechRequestSchema,
  transcriptionQuerySchema,
} from '@app/shared';
import { SPEECH_STYLE, createVoiceService } from '../src/features/voice/voice.service.js';
import { audioTypeOf } from '../src/features/voice/voice.routes.js';
import { HttpError, NotFoundError } from '../src/lib/errors.js';
import { requireJson } from '../src/middleware/local-only.js';

async function setup() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-api-voice-'));
  const store = new Store({ appHome: path.join(tmp, 'home') });
  const folder = path.join(tmp, 'project');
  await fs.mkdir(folder);
  const model = await store.models.create({
    name: 'Speech',
    model: 'gpt-4.1',
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'sk-test',
  });
  const workspace = await store.createWorkspace({ name: 'Project', path: folder });
  const workspaces = {
    require: async (id: string) => {
      const found = await store.getWorkspace(id);
      if (!found) throw new NotFoundError('No such workspace.');
      return found;
    },
  };
  const calls: Array<{ baseURL?: string; model: string; filename: string; language?: string }> = [];
  const spoken: Array<{
    baseURL?: string;
    text: string;
    model: string;
    voice: string;
    instructions?: string;
  }> = [];
  const service = createVoiceService(
    { store },
    workspaces,
    async (config, audio, name, opts) => {
      calls.push({ baseURL: config.baseURL, model: name, filename: audio.filename, ...opts });
      return 'hello world';
    },
    async (config, text, name, voice, opts) => {
      spoken.push({
        baseURL: config.baseURL,
        text,
        model: name,
        voice,
        instructions: opts?.instructions,
      });
      return Buffer.from('fake-mp3');
    },
  );
  return { store, service, workspace, model, calls, spoken };
}

const audio = { data: Buffer.from('fake-audio'), mimeType: 'audio/webm;codecs=opus' };

test('a workspace without a voice setting is a clear 400', async () => {
  const { service, workspace } = await setup();
  await assert.rejects(
    service.transcribe({ workspaceId: workspace.id }, audio),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
});

test("the workspace's saved setting picks the server, model and language", async () => {
  const { store, service, workspace, model, calls } = await setup();
  const saved = await store.updateWorkspace(workspace.id, {
    voice: { modelId: model.id, transcriptionModel: 'whisper-1', language: 'en' },
  });
  assert.deepEqual(saved?.voice, {
    modelId: model.id,
    transcriptionModel: 'whisper-1',
    language: 'en',
    speechModel: DEFAULT_SPEECH_MODEL,
    speechVoice: DEFAULT_SPEECH_VOICE,
  });
  const result = await service.transcribe({ workspaceId: workspace.id }, audio);
  assert.deepEqual(result, { text: 'hello world' });
  assert.deepEqual(calls, [
    {
      baseURL: 'http://127.0.0.1:9/v1',
      model: 'whisper-1',
      filename: 'recording.webm',
      language: 'en',
      signal: undefined,
    },
  ]);
});

test('the settings test can try a setting before it is saved; a deleted model is a 404', async () => {
  const { service, model, calls } = await setup();
  await service.transcribe({ modelId: model.id, transcriptionModel: 'auto' }, audio);
  assert.equal(calls[0]?.model, 'auto');
  await assert.rejects(
    service.transcribe(
      { modelId: '00000000-0000-4000-8000-000000000000', transcriptionModel: 'auto' },
      audio,
    ),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
});

test('empty recordings are refused; turning voice off saves null', async () => {
  const { store, service, workspace, model } = await setup();
  await assert.rejects(
    service.transcribe(
      { modelId: model.id, transcriptionModel: 'auto' },
      { ...audio, data: Buffer.alloc(0) },
    ),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  await store.updateWorkspace(workspace.id, {
    voice: { modelId: model.id, transcriptionModel: 'whisper-1' },
  });
  assert.equal((await store.getWorkspace(workspace.id))?.voice?.language, '');
  await store.updateWorkspace(workspace.id, { voice: null });
  assert.equal((await store.getWorkspace(workspace.id))?.voice, null);
});

test('the query needs a workspace, or a model and a transcription model', () => {
  assert.equal(transcriptionQuerySchema.safeParse({}).success, false);
  assert.equal(
    transcriptionQuerySchema.safeParse({ modelId: '00000000-0000-4000-8000-000000000000' }).success,
    false,
  );
});

test('requireJson lets audio through only on the transcription route', () => {
  const run = (path: string, type: string) => {
    let result: unknown = 'not called';
    requireJson(
      { method: 'POST', path, headers: { 'content-type': type } } as unknown as Request,
      {} as Response,
      (error?: unknown) => {
        result = error;
      },
    );
    return result;
  };
  assert.equal(run('/v1/voice/transcriptions', 'audio/webm;codecs=opus'), undefined);
  assert.ok(run('/v1/voice/transcriptions', 'text/plain') instanceof HttpError);
  assert.ok(run('/v1/workspaces', 'audio/webm') instanceof HttpError);
});

test("replies are spoken by the workspace's speech model and voice on the server", async () => {
  const { store, service, workspace, model, spoken } = await setup();
  await assert.rejects(
    service.speak({ text: 'Hi', workspaceId: workspace.id }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
    'no voice setting yet',
  );
  await store.updateWorkspace(workspace.id, {
    voice: {
      modelId: model.id,
      transcriptionModel: 'whisper-1',
      speechModel: 'tts-1-hd',
      speechVoice: 'nova',
    },
  });
  const audio = await service.speak({ text: 'All tests pass.', workspaceId: workspace.id });
  assert.equal(audio.toString(), 'fake-mp3');
  assert.deepEqual(spoken, [
    {
      baseURL: 'http://127.0.0.1:9/v1',
      text: 'All tests pass.',
      model: 'tts-1-hd',
      voice: 'nova',
      instructions: SPEECH_STYLE,
    },
  ]);
});

test('the settings sample is spoken with the unsaved setting; a deleted model is a 404', async () => {
  const { service, model, spoken } = await setup();
  await service.speak({
    text: 'Sample',
    modelId: model.id,
    speechModel: 'gpt-4o-mini-tts',
    speechVoice: 'coral',
  });
  assert.equal(spoken[0]?.voice, 'coral');
  await assert.rejects(
    service.speak({
      text: 'Sample',
      modelId: '00000000-0000-4000-8000-000000000000',
      speechModel: 'tts-1',
      speechVoice: 'alloy',
    }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
});

test('a speech request needs text, and a workspace or a full setting', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  assert.equal(speechRequestSchema.safeParse({ text: 'Hi' }).success, false);
  assert.equal(speechRequestSchema.safeParse({ text: '  ', workspaceId: id }).success, false);
  assert.equal(speechRequestSchema.safeParse({ text: 'Hi', modelId: id }).success, false);
  assert.equal(speechRequestSchema.safeParse({ text: 'Hi', workspaceId: id }).success, true);
  assert.equal(
    speechRequestSchema.safeParse({
      text: 'x'.repeat(5000),
      workspaceId: id,
    }).success,
    false,
  );
});

test('a speech server error is a 502 with its message', async () => {
  const { store, workspace, model } = await setup();
  const failing = createVoiceService(
    { store },
    {
      require: async (id: string) => {
        const found = await store.getWorkspace(id);
        if (!found) throw new NotFoundError('No such workspace.');
        return found;
      },
    },
    async () => '',
    async () => {
      throw new Error('No model "tts-9".');
    },
  );
  await store.updateWorkspace(workspace.id, {
    voice: { modelId: model.id, transcriptionModel: 'whisper-1' },
  });
  await assert.rejects(
    failing.speak({ text: 'Hi', workspaceId: workspace.id }),
    (error: unknown) =>
      error instanceof HttpError && error.status === 502 && /tts-9/.test(error.message),
  );
});

test('spoken audio is labelled with its real type, whatever the server was asked for', () => {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
  assert.equal(audioTypeOf(wav), 'audio/wav');
  assert.equal(audioTypeOf(Buffer.from('OggS\0\0\0\0')), 'audio/ogg');
  assert.equal(audioTypeOf(Buffer.from('fLaC\0\0\0\0')), 'audio/flac');
  assert.equal(audioTypeOf(Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0])), 'audio/mpeg');
  assert.equal(audioTypeOf(Buffer.from([0xff, 0xfb, 0x90, 0x00])), 'audio/mpeg');
});
