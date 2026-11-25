// Offline tests for voice mode's text and turn detection. Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VAD,
  createTurnDetector,
  frameFeatures,
  type FrameFeatures,
} from '../src/features/voice/voiceActivity';
import {
  isMeaningfulTranscript,
  speakableSoFar,
  speakableText,
  speechChunks,
  unsaid,
} from '../src/features/voice/voiceText';

test('only the prose of a reply is read: code, tables and formatting are dropped', () => {
  const reply = [
    '## Done',
    'I updated **two files** and ran `npm test`.',
    '```ts',
    'const x = 1;',
    '```',
    '| File | Lines |',
    '|---|---|',
    '| a.ts | 3 |',
    '- See [the docs](https://example.com/docs)',
  ].join('\n');
  assert.equal(speakableText(reply), 'Done. I updated two files and ran npm test. See the docs.');
});

test('a reply that is all code says it is on screen', () => {
  assert.equal(speakableText('```js\nconsole.log(1)\n```'), 'The answer is on screen.');
  assert.equal(speakableText(''), '');
});

test('a long reply is cut at a sentence end and points to the screen', () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const spoken = speakableText(long, 120);
  assert.ok(spoken.length < 160);
  assert.match(spoken, /here\. The rest is on screen\.$/);
});

test('speech is split into sentence-sized chunks', () => {
  const chunks = speechChunks('One. Two! Three? Four', 12);
  assert.deepEqual(chunks, ['One. Two!', 'Three? Four']);
  assert.ok(speechChunks('a'.repeat(50) + '. ' + 'b'.repeat(50) + '.', 60).length === 2);
});

// Frames as the detector sees them.
const QUIET: FrameFeatures = { levelDb: -80, bandShare: 0.5, flatness: 0.6 };
const VOICE: FrameFeatures = { levelDb: -40, bandShare: 0.8, flatness: 0.15 };
/** Loud but flat (a fan, rain, a hiss). */
const HISS: FrameFeatures = { levelDb: -40, bandShare: 0.6, flatness: 0.8 };
/** Loud but low (a rumble, a truck, a thump). */
const RUMBLE: FrameFeatures = { levelDb: -40, bandShare: 0.1, flatness: 0.2 };

/** Feeds `frame` for `ms` (30 ms frames) and returns the first signal that isn't `continue`. */
function feeder() {
  const detector = createTurnDetector(0);
  let now = 0;
  return (frame: FrameFeatures, ms: number) => {
    for (let t = 0; t < ms; t += 30) {
      now += 30;
      const signal = detector.push(frame, now);
      if (signal !== 'continue') return signal;
    }
    return detector.isInTurn ? 'in turn' : 'continue';
  };
}

test('a spoken turn starts on speech and ends after a pause, short pauses included', () => {
  const feed = feeder();
  assert.equal(feed(QUIET, 1000), 'continue');
  assert.equal(feed(VOICE, 800), 'in turn');
  assert.equal(feed(QUIET, 600), 'in turn'); // a short pause between sentences
  assert.equal(feed(VOICE, 400), 'in turn');
  assert.equal(feed(QUIET, VAD.silenceMs + 60), 'end');
});

test('hiss, fan noise and rumble never start a turn', () => {
  for (const noise of [HISS, RUMBLE]) {
    const feed = feeder();
    assert.equal(feed(QUIET, 600), 'continue');
    assert.equal(feed(noise, 5000), 'continue');
  }
});

test('a click or cough is dropped: too short to start a turn, or a turn with too little speech', () => {
  const click = feeder();
  assert.equal(click(QUIET, 600), 'continue');
  assert.equal(click(VOICE, 90), 'continue');
  assert.equal(click(QUIET, 3000), 'continue');

  const cough = feeder();
  assert.equal(cough(QUIET, 600), 'continue');
  assert.equal(cough(VOICE, 300), 'in turn');
  assert.equal(cough(QUIET, VAD.silenceMs + 60), 'discard');
});

test('speech-like sound no louder than the room is not speech', () => {
  const feed = feeder();
  // A loud room (a TV in the next room): the floor learns it.
  const room: FrameFeatures = { levelDb: -45, bandShare: 0.6, flatness: 0.5 };
  assert.equal(feed(room, 3000), 'continue');
  assert.equal(feed({ ...VOICE, levelDb: -42 }, 2000), 'continue');
  assert.equal(feed(VOICE, 0), 'continue');
  assert.equal(feed({ ...VOICE, levelDb: -25 }, 600), 'in turn');
});

test('a voice that misses one test does not lift the noise floor out of reach', () => {
  const feed = feeder();
  assert.equal(feed(QUIET, 600), 'continue');
  // Loud, voice-like sound just too flat to count (soft onsets, noise suppression at work).
  assert.equal(feed({ ...VOICE, flatness: VAD.maxFlatness + 0.08 }, 3000), 'continue');
  assert.equal(feed(VOICE, 600), 'in turn');
});

test('speech keeps the floor from rising between words', () => {
  const feed = feeder();
  assert.equal(feed(QUIET, 600), 'continue');
  for (let word = 0; word < 6; word += 1) {
    // A short word (too short to start a turn alone), then a near-miss tail.
    assert.equal(feed(VOICE, 90), 'continue');
    assert.equal(feed({ ...VOICE, bandShare: VAD.minBandShare - 0.05 }, 400), 'continue');
  }
  assert.equal(feed(VOICE, 400), 'in turn');
});

test('a quiet mic in a silent room is still heard', () => {
  const feed = feeder();
  assert.equal(feed({ ...QUIET, levelDb: -88 }, 800), 'continue');
  assert.equal(feed({ ...VOICE, levelDb: -66 }, 600), 'in turn');
});

test('a room that really gets louder is learned, over seconds', () => {
  const feed = feeder();
  assert.equal(feed(QUIET, 600), 'continue');
  // Voice-like and only a little over the floor at each step: a slow swell (a TV turned up).
  let level = -80;
  for (let t = 0; t < 40; t += 1) {
    level += 0.5;
    assert.equal(feed({ ...VOICE, levelDb: level, flatness: 0.6 }, 300), 'continue');
  }
  assert.equal(feed({ ...VOICE, levelDb: level - 1 }, 600), 'continue');
});

test('nothing said for a long while starts the recording over', () => {
  const feed = feeder();
  assert.equal(feed(QUIET, VAD.idleRestartMs + 60), 'restart');
});

test('frame features tell a voice-like spectrum from flat noise', () => {
  const fftSize = 1024;
  const sampleRate = 48_000;
  const hzPerBin = sampleRate / fftSize;
  const bins = (fn: (hz: number) => number) =>
    Array.from({ length: fftSize / 2 }, (_, i) => fn(i * hzPerBin));
  // Harmonics every 150 Hz, strong in the speech band.
  const voiced = frameFeatures(
    bins((hz) => (hz > 250 && hz < 3500 ? (hz % 150 < hzPerBin ? -30 : -75) : -90)),
    sampleRate,
    fftSize,
  );
  const flat = frameFeatures(
    bins(() => -50),
    sampleRate,
    fftSize,
  );
  const low = frameFeatures(
    bins((hz) => (hz < 200 ? -20 : -90)),
    sampleRate,
    fftSize,
  );
  assert.ok(voiced.flatness < VAD.maxFlatness, `voiced flatness ${voiced.flatness}`);
  assert.ok(voiced.bandShare > 0.9);
  assert.ok(flat.flatness > 0.95);
  assert.ok(low.bandShare < VAD.minBandShare);
});

test('only real words are sent: no fillers, sound tags or phantom phrases', () => {
  for (const junk of [
    '',
    '   ',
    'you',
    'Thank you.',
    'Thanks for watching!',
    '[Music]',
    '(coughs)',
    '[BLANK_AUDIO]',
    '♪♪',
    'Um...',
    'you you you you',
  ]) {
    assert.equal(isMeaningfulTranscript(junk), false, junk);
  }
  assert.equal(isMeaningfulTranscript('List the files in src'), true);
  assert.equal(isMeaningfulTranscript('Thank you, now run the tests'), true);
  assert.equal(isMeaningfulTranscript('Yes'), true);
});

test('the assistant’s own reply heard back through the speakers is not sent', () => {
  const spoken = 'I updated two files and ran the tests. All of them pass now.';
  assert.equal(isMeaningfulTranscript('ran the tests all of them pass now', spoken), false);
  assert.equal(isMeaningfulTranscript('All of them pass now.', spoken), false);
  assert.equal(isMeaningfulTranscript('Great, now commit the two files please', spoken), true);
  assert.equal(isMeaningfulTranscript('Yes', 'Yes, I can do that.'), true);
});

test('the first spoken part is short so audio starts quickly; later parts are larger', () => {
  const text = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i}.`).join(' ');
  const parts = speechChunks(text, 120, 40);
  assert.ok((parts[0] ?? '').length <= 40, parts[0]);
  assert.ok(parts.slice(1).every((part) => part.length <= 120));
  assert.ok(parts.slice(1, -1).some((part) => part.length > 40));
  assert.equal(parts.join(' '), text);
});

test('a reply still streaming is read up to its last finished sentence', () => {
  assert.equal(speakableSoFar('Sure, I can', false), '');
  assert.equal(speakableSoFar('Sure. I can help with th', false), 'Sure.');
  assert.equal(
    speakableSoFar('Sure. I can help with that. Le', false),
    'Sure. I can help with that.',
  );
  assert.equal(speakableSoFar('Sure. I can help', true), 'Sure. I can help.');
  // A finished line (a list item, a heading) counts as said.
  assert.equal(speakableSoFar('## Plan\n- First step\n- Sec', false), 'Plan. First step.');
});

test('an open code block is never read while it streams', () => {
  assert.equal(speakableSoFar('Here it is.\n```ts\nconst a = 1;\nconst b', false), 'Here it is.');
  assert.equal(speakableSoFar('```ts\nconst a = 1;\n', false), '');
});

test('each step of a growing reply adds only its new words', () => {
  const text = 'One thing. Then **another** thing. And a last one.';
  const steps = [20, 36, text.length];
  let said = '';
  const heard: string[] = [];
  for (const [index, length] of steps.entries()) {
    const now = speakableSoFar(text.slice(0, length) + ' ', index === steps.length - 1);
    const fresh = unsaid(said, now);
    if (fresh) heard.push(fresh);
    said = now;
  }
  assert.equal(heard.join(' '), 'One thing. Then another thing. And a last one.');
  assert.equal(unsaid('Same.', 'Same.'), '');
  // Text that changed before the end goes on from the next sentence, never repeating.
  assert.equal(unsaid('Use *this.', 'Use this. Then that.'), 'Then that.');
});

test('a voice reply is read only from its <spoken> blocks, as they finish', async () => {
  const { spokenSoFar } = await import('../src/features/voice/voiceText');
  const reply =
    '<spoken>I fixed the login bug. The tests pass now.</spoken>\n\n## Details\n```ts\nx\n```';
  assert.equal(spokenSoFar(reply, true), 'I fixed the login bug. The tests pass now.');
  // Streaming: only finished sentences, and no half-written closing tag.
  assert.equal(spokenSoFar('<spoken>I fixed it. Now I am', false), 'I fixed it.');
  assert.equal(spokenSoFar('<spoken>I fixed it.</spo', false), 'I fixed it.');
  // No spoken block: not meant to be heard (voice mode falls back to the answer).
  assert.equal(spokenSoFar('Just **text**.', true), null);
  // Several notes are joined in order.
  assert.equal(
    spokenSoFar('<spoken>Looking at the tests.</spoken> x <spoken>Found it.</spoken>', true),
    'Looking at the tests. Found it.',
  );
});

test('the chat shows a voice reply without its <spoken> tags', async () => {
  const { withoutSpokenTags } = await import('@app/shared');
  assert.equal(
    withoutSpokenTags('<spoken>All done.</spoken>\nHere are the details.'),
    'All done.\n\nHere are the details.',
  );
  // A tag still arriving is hidden until it's complete.
  assert.equal(withoutSpokenTags('<spoken>All done.</spo'), 'All done.');
  assert.equal(withoutSpokenTags('<spo'), '');
  assert.equal(withoutSpokenTags('a < b'), 'a < b');
});
