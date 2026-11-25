# Voice input: design plan

Status: proposal, not built yet.

Goal: add two buttons next to Send in the message box, as in Claude and Cursor:

| Button | Name | What it does |
|---|---|---|
| Mic | **Dictation** | Turns speech into text in the box. The user reviews it and sends. |
| Waveform | **Voice mode** | Hands-free loop: listen, send, read the reply aloud, listen again. |

Build in two phases. Phase 1 (dictation) is useful by itself. Phase 2 builds on it.

---

## Where things stand

- The message box is `apps/web/src/features/chat/Composer.tsx`. It has a textarea, attach, improve-prompt and Send/Stop. Nothing in web or desktop handles audio yet.
- Model calls happen only in `packages/agent/src/llm.ts` (OpenAI SDK, any compatible `baseURL`).
- Models are saved by `packages/db/src/models.ts` in `~/.code-ai/models.json`. Their shape lives in `packages/shared/src/model.ts`.
- The API parses JSON with a 1 MB limit (`apps/api/src/app.ts`). Uploads get their own larger limit, and audio will need the same treatment.
- Desktop: `setPermissionRequestHandler` already allows permissions for the app's own page, which covers the microphone. The mac build has no `NSMicrophoneUsageDescription` yet (see the Desktop section).

---

## Phase 1: Dictation (mic button)

### How speech becomes text

**Built: server transcription only.** The browser's own speech engines (`SpeechRecognition`, `speechSynthesis`) are deliberately not used anywhere: speech to text and text to speech both run on a server's AI speech models.

1. **Server transcription.** The browser records with `MediaRecorder` (webm/opus, or mp4 on Safari). It sends the audio to our API, which calls `audio.transcriptions.create` on an OpenAI-compatible server (OpenAI `whisper-1` / `gpt-4o-mini-transcribe`, Groq `whisper-large-v3`, or a local whisper server).
   - Good: works the same in the browser and in Electron.
   - Bad: needs a provider with an `/audio/transcriptions` endpoint. Ollama, OpenRouter and many others don't have one.
2. ~~Browser `SpeechRecognition` (fallback).~~ Not used: it's Chrome-only, needs Google's servers and can't run in Electron. Without a server set up, the mic opens Workspace settings → Voice.

Option for later: run Whisper inside the browser with transformers.js, for private and offline use. Not in phase 1, because the model download is about 40–150 MB.

### Choosing the speech model

Use an **app setting**, not a new kind of model. Add `speechModel: { modelId, transcriptionModel } | null` under Settings → Agent (or a "Voice" section):

- `modelId` reuses an existing saved model's `baseUrl` and API key, so keys stay in one place.
- `transcriptionModel` is the model name to send, for example `whisper-1`.

Then no model schema changes are needed, and "transcribe with my OpenAI key" is a single dropdown.

### Changes by package (dependency order)

**`@app/shared`**
- `TRANSCRIBE_LIMITS`: maximum audio size (25 MB, which is OpenAI's cap) and maximum length (for example 5 min).
- Response type `TranscriptionResult { text: string }` and the zod schema for the `speechModel` setting.

**`@app/agent` (`llm.ts`)**
- `transcribeAudio(config: ModelSettings, audio: { data: Buffer; mimeType: string; filename: string }, model: string, signal?)` returns `Promise<string>`.
  - Uses `client.audio.transcriptions.create({ file: await toFile(...), model })`.
  - Map errors the same way chat calls do. A 404 should say "this server doesn't support transcription".

**`@app/db`**
- Read and write `speechModel` in agent settings (`settings.ts`).
- Add a helper that returns the saved model's settings plus the transcription model name.

**`@app/api`**
- New feature `features/voice/`: `POST /v1/voice/transcriptions`.
  - Takes the raw body (`express.raw({ type: 'audio/*', limit: '25mb' })`), registered **before** the global `express.json`.
  - Returns `{ text }` in the usual envelope. A missing speech model returns a clear 400.
- Add `canTranscribe: boolean` to the info/settings response, so the web app knows which engine to use.

**`@app/web`**
- `features/chat/voice/useDictation.ts`: a hook with states idle, listening, transcribing and error.
  - Wraps both engines behind one API: `start()`, `stop()`, `cancel()`, and `onText(text)`.
  - Releases the mic tracks on stop and when the component unmounts.
- `DictationButton.tsx`: the mic icon. Show a pulsing state while listening, a spinner while transcribing and a toast on error.
  - Shortcut: hold or toggle with Ctrl/Cmd+Shift+Space (to be decided).
- `Composer.tsx`: put the button next to Send. Insert the text **at the cursor**, the same way paths are inserted on drop (adding spaces as needed). Keep focus in the box. Never send automatically.
- `lib/icons.tsx`: add `MicIcon` and `WaveformIcon`.
- Settings UI: a speech model picker (a saved-model dropdown plus a transcription model name field).

**CLI**: out of scope. Recording from a terminal needs native tools (sox and similar).

### Desktop (Electron)
- Add `NSMicrophoneUsageDescription` to the mac build's `extendInfo` (electron-builder config in `apps/desktop/package.json`). Without it macOS refuses the mic.
- If the hardened runtime / entitlements are used, add `com.apple.security.device.audio-input`.
- Optionally call `systemPreferences.askForMediaAccess('microphone')` before the first recording.
- Check that the current permission handler lets `media` through for the app's own page.

### Privacy and safety
- Audio is never saved to disk. It is sent once and thrown away.
- Make it clear in the UI that server transcription sends audio to the chosen provider.
- The route is local-only, the same as the rest of the API (`middleware/local-only.ts`).

### Tests
- `@app/agent`: `transcribeAudio` with a fake client, covering success, 404 and abort.
- `@app/api`: route tests for the missing setting, too-large body, wrong content type, and success with a stubbed agent function.
- `@app/web`: the hook's state machine, using a mocked `MediaRecorder` and `getUserMedia`.

---

## Phase 2: Voice mode (waveform button)

**Status: built, with server text-to-speech.** `apps/web/src/features/voice/`: `useVoiceMode.ts` (the loop, owned by `ChatView`), `VoiceModeButton.tsx` (waveform in the composer, next to the mic), `VoiceModeBar.tsx` (the "Voice chat 0:12" bar above the composer: live waveform, stop speaking, mute, read aloud on/off, end), `voiceText.ts` (pure: end-of-turn detection with an adaptive noise floor, and the speakable prose of a reply; tests in `apps/web/test/voice-mode.test.ts`). Needs the workspace's speech-to-text setting, like dictation. Switching chats or Esc ends it. Barge-in (talking over a reply) is not built.

Noise and self-echo handling:
- The mic opens with `echoCancellation`, `noiseSuppression` and `autoGainControl` (`micPrefs.ts`).
- The mic is closed while a reply is spoken, and reopens 500 ms after the reply's audio ends.
- `voiceActivity.ts` decides what is speech from the analyser's spectrum: speech-band (300 to 3400 Hz) level well over a learned noise floor, most energy in that band, and a peaky (not flat) spectrum. A turn needs ~220 ms of speech to start, and one with under ~550 ms of speech is thrown away without being transcribed.
- `isMeaningfulTranscript` (`voiceText.ts`) drops what the server makes of noise (`[Music]`, "Thank you.", "you", fillers) and transcripts that repeat the reply just read aloud.

A loop on top of Phase 1:

1. **Listen** with voice activity detection: stop after about 1.2 s of silence, using an `AnalyserNode` energy check (or `@ricky0123/vad-web` later).
2. **Transcribe**, then **send** through the normal `onSend`, so runs, plans and approvals work as usual.
3. **Speak** the reply.
4. **Listen again.** Pressing the waveform button or Esc ends the loop.

Speaking the reply (built): **server text-to-speech only**, never the browser's `speechSynthesis` (it sounds robotic and differs per OS).
- The workspace voice setting has `speechModel` (default `gpt-4o-mini-tts`) and `speechVoice` (default `alloy`), on the same saved model's server as transcription. Settings saved before this get the defaults. Workspace settings → Voice has a "play a sample" test.
- `POST /v1/voice/speech` `{ text, workspaceId }` (or `modelId`, `speechModel`, `speechVoice` for the test) calls `synthesizeSpeech` (`packages/agent/src/llm.ts`, `audio.speech.create`, mp3) and answers with `audio/mpeg`. The gpt-4o speech models also get a short conversational speaking style.
- The reply is read **while it streams**: each finished sentence (never inside an open code block) is sent for speech as soon as it arrives (`speakableSoFar` / `unsaid` in `voiceText.ts`), so the voice keeps up with the screen instead of starting after the run ends. Parts are short at first (~100 chars, so audio starts fast), then up to ~600 chars; each is fetched while earlier ones play, and plays each through an `<audio>` element (`speechPlayer.ts`), whose output level drives the bar's waveform. A speech failure is shown once per voice chat; the loop goes on with replies on screen.
- Needs a server with `/audio/speech`: OpenAI, or a local OpenAI-compatible one (Kokoro-FastAPI, openedai-speech, …).

Specific to this agent:
- Replies contain code, tables and tool output, so **speak only the prose**: remove code blocks and tables, and cap the length (for example the first ~600 characters, then "…details are on screen").
- When a run stops for approval or a question, say a short prompt ("I need your approval to run a command") and stop listening until the user deals with it on screen.
- Interrupting: if the user starts talking while the reply is being spoken, stop the speech (barge-in). This can wait until after the first version.
- UI: a voice overlay or a bar above the composer showing listening, thinking or speaking, with a live level meter and an End button.

Not planned: a real-time speech-to-speech API (OpenAI Realtime). It would skip the agent's tool loop, so it doesn't suit this app.

---

## Open questions
1. Push-to-talk (hold) or toggle (click to start and stop) for the mic? Suggest toggle, with hold as a shortcut option.
2. Is a speech model setting enough, or should the app also detect when the default model's server supports `/audio/transcriptions`?
3. Should voice mode use a short "voice reply" style prompt so the model writes answers that are easy to listen to?

## Rough effort
| Piece | Estimate |
|---|---|
| Phase 1, browser fallback only | ~0.5 day |
| Phase 1, full (server + fallback + settings + desktop) | 1–2 days |
| Phase 2, voice mode with server text-to-speech | built |
| Phase 2, barge-in | +1 day |
