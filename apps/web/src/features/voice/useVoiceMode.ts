import { useCallback, useEffect, useRef, useState } from 'react';
import { readPref, writePref } from '../../lib/storage';
import { useToast } from '../../lib/toast';
import { answerText, type ConversationState } from '../chat/conversation';
import { synthesize, transcribe } from './api';
import { playAudio, type Playback } from './speechPlayer';
import { canRecord, readMicId } from './micPrefs';
import { useRecorder } from './useRecorder';
import { VAD, createTurnDetector, frameFeatures } from './voiceActivity';
import {
  isMeaningfulTranscript,
  speakableText,
  spokenSoFar,
  speechChunks,
  unsaid,
} from './voiceText';

/**
 * Where the voice chat is: `listening` (the mic is open and waits for a pause after speech),
 * `transcribing`, `waiting` (the agent works on what was said), `speaking` (the reply is read
 * aloud), or `off`. Muting keeps the chat open but closes the mic.
 */
export type VoicePhase = 'off' | 'starting' | 'listening' | 'transcribing' | 'waiting' | 'speaking';

/** Speech being read aloud, fed as it comes (see `openSpeech` in `useVoiceMode`). */
type SpeechQueue = {
  add: (text: string) => void;
  /** No more text: calls `then` once all of it was played (or speech failed). */
  close: (then: () => void) => void;
  /** Still taking text: not closed, nor stopped by other speech or listening. */
  isLive: () => boolean;
  /** Still has something to play (and wasn't stopped). */
  isActive: () => boolean;
};

/** The reply to the last message as far as it was read aloud while it streamed. */
type ReplySpeech = {
  /** What of each text block was read (its `speakableSoFar` then), by the block's key. */
  said: Map<string, string>;
  /** Everything read so far, so the mic hearing it back isn't taken as the user. */
  spoken: string;
  speech: SpeechQueue | null;
};

const freshReply = (): ReplySpeech => ({ said: new Map(), spoken: '', speech: null });

/** Whether replies are read aloud (a UI preference). */
const SPEAK_KEY = 'agent.voiceSpeakReplies';
/**
 * Shows the speech detector's numbers under the voice bar, for tuning a mic. Turn on in the
 * devtools console: localStorage.setItem('agent.voiceDebug', 'true'), then start voice mode.
 */
const DEBUG_KEY = 'agent.voiceDebug';
/** How often the mic's spectrum is checked for speech, in ms. */
const CHECK_MS = 30;
/**
 * After the spoken reply ends, the mic stays closed this much longer: speakers and the room
 * ring on for a moment, and the mic would hear it.
 */
const SPEAKER_TAIL_MS = 500;
/**
 * Replies are synthesized in parts so the first words play quickly: a short first part, then
 * larger ones, each made while the one before plays.
 */
const FIRST_PART_CHARS = 100;
const PART_CHARS = 600;

/**
 * Voice mode (the composer's waveform button): a hands-free loop. It listens, ends the turn
 * after a pause, turns the speech into text with the workspace's speech-to-text setting, sends
 * it as a normal message marked as voice (so plans, tools and approvals work as usual, and the
 * agent writes what is to be heard in `<spoken>` blocks: short progress notes and a brief spoken
 * answer, as in Cursor's voice chat), reads those aloud with the server's text-to-speech, then
 * listens again. A reply without them is read as its cleaned-up answer instead. Esc or End stops it.
 *
 * When the agent asks a question or needs an approval, it says so and waits for the user to
 * deal with it on screen; the loop goes on once the run ends.
 */
export function useVoiceMode({
  workspaceId,
  chatKey,
  state,
  isBusy,
  canSend,
  onSend,
}: {
  workspaceId: string;
  /** The open chat; switching to another one ends voice mode. */
  chatKey: string;
  state: ConversationState;
  /** This tab's run for the chat is going. */
  isBusy: boolean;
  /** A message can be sent now (a model is set up, nothing else runs). */
  canSend: boolean;
  onSend: (text: string) => void;
}) {
  const toast = useToast();
  const [phase, setPhaseState] = useState<VoicePhase>('off');
  const phaseRef = useRef<VoicePhase>('off');
  const setPhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const [isMuted, setIsMutedState] = useState(false);
  const isMutedRef = useRef(false);
  const [speaksReplies, setSpeaksReplies] = useState(() => readPref(SPEAK_KEY) !== 'false');
  const speaksRef = useRef(speaksReplies);
  speaksRef.current = speaksReplies;
  const [startedAt, setStartedAt] = useState<number | null>(null);
  /** The level the bar's waveform draws: the mic while listening, a pulse while speaking. */
  const displayLevelRef = useRef(0);
  /** Whether the run started after the last message was sent (so its end is the reply). */
  const sawBusyRef = useRef(false);
  /** The question or approval already announced, so it's said once. */
  const announcedRef = useRef<string | null>(null);
  /** Bumped on every speak / stop, so a late `onend` from an old utterance is ignored. */
  const speechIdRef = useRef(0);
  /** What was read aloud last, so the mic hearing it back isn't taken as the user. */
  const lastSpokenRef = useRef('');
  /** The pending "open the mic once it's quiet" timer. */
  const reopenRef = useRef(0);
  /** The reply audio playing now, and the speech requests under way (stopped together). */
  const playbackRef = useRef<Playback | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  /** A speech error is said once per voice chat, not for every reply. */
  const hasSpeechErrorRef = useRef(false);
  /** Whether a turn is being heard now (speech started), for the bar. */
  const [isHearing, setIsHearing] = useState(false);
  /** Whether the detector's debug readout shows (read when voice mode starts). */
  const [showsDebug, setShowsDebug] = useState(false);
  /** The readout's element: its text is set straight from the detector loop, no re-render. */
  const debugRef = useRef<HTMLElement | null>(null);

  const latest = useRef({ canSend, onSend });
  latest.current = { canSend, onSend };
  /** How many turns the chat had when the last message was sent; the reply comes after them. */
  const turnsAtSendRef = useRef(0);
  const turnCountRef = useRef(state.turns.length);
  /** The reply being read aloud as it streams. */
  const replyRef = useRef<ReplySpeech>(freshReply());
  /** A question or approval being said. */
  const announcingRef = useRef<SpeechQueue | null>(null);
  turnCountRef.current = state.turns.length;

  const recorder = useRecorder({
    micId: readMicId(),
    onRecorded: useCallback(
      async (audio: Blob, signal: AbortSignal) =>
        (await transcribe(audio, { workspaceId }, signal)).text,
      [workspaceId],
    ),
    onText: (text) => {
      if (phaseRef.current === 'off') return;
      // Noise the server turned into words, a filler, or our own voice heard back: drop it.
      if (!isMeaningfulTranscript(text, lastSpokenRef.current)) {
        listen();
        return;
      }
      if (!latest.current.canSend) {
        toast("The message couldn't be sent yet. Say it again in a moment.", 'warning');
        listen();
        return;
      }
      sawBusyRef.current = false;
      turnsAtSendRef.current = turnCountRef.current;
      replyRef.current = freshReply();
      setPhase('waiting');
      latest.current.onSend(text);
    },
    // Nothing worth sending (a cough, a door): just keep listening.
    onEmpty: () => {
      if (phaseRef.current !== 'off') listen();
    },
    onError: (message) => {
      if (phaseRef.current === 'off') return;
      toast(message, 'error');
      end();
    },
  });
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  const stopSpeaking = useCallback(() => {
    speechIdRef.current += 1;
    window.clearTimeout(reopenRef.current);
    reopenRef.current = 0;
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
  }, []);

  /**
   * Opens the mic for the user's next turn (unless muted: then it waits for unmute), once the
   * speakers are quiet: never while the reply is still playing, or the mic would hear it.
   */
  const listen = useCallback(() => {
    if (phaseRef.current === 'off') return;
    const wasSpeaking = phaseRef.current === 'speaking';
    stopSpeaking();
    setPhase('listening');
    setIsHearing(false);
    const open = () => {
      reopenRef.current = 0;
      if (phaseRef.current !== 'listening' || isMutedRef.current) return;
      void recorderRef.current.start();
    };
    // The reply's audio is stopped by now; give the speakers a moment to fall silent.
    if (wasSpeaking) reopenRef.current = window.setTimeout(open, SPEAKER_TAIL_MS);
    else open();
  }, [setPhase, stopSpeaking]);

  /**
   * Starts reading aloud with the server's text-to-speech model: text `add`ed is synthesized at
   * once (each part while the one before plays) and played in order; `close` calls `then` once
   * all of it was played. A reply still being written is fed in sentence by sentence, so its
   * first words play while the rest streams in. If speech fails, it says so once and goes on.
   */
  const openSpeech = useCallback((): SpeechQueue => {
    stopSpeaking();
    const id = speechIdRef.current;
    const abort = new AbortController();
    speechAbortRef.current = abort;
    const isCurrent = () => speechIdRef.current === id && !abort.signal.aborted;
    // The mic is never open while speaking (it would hear the reply).
    recorderRef.current.cancel();
    const queue: Promise<Blob>[] = [];
    let then: (() => void) | null = null;
    let wake: (() => void) | null = null;
    let hasPlayed = false;
    let isFinished = false;
    let hasFailed = false;
    abort.signal.addEventListener('abort', () => wake?.());

    const finish = () => {
      isFinished = true;
      if (!isCurrent() || !then) return;
      playbackRef.current = null;
      speechAbortRef.current = null;
      then();
    };

    void (async () => {
      try {
        for (;;) {
          const next = queue.shift();
          if (!next) {
            if (then) break;
            // Caught up with a reply still being written: wait for its next sentence.
            if (phaseRef.current === 'speaking') setPhase('waiting');
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = null;
            if (!isCurrent()) return;
            continue;
          }
          const audio = await next;
          if (!isCurrent()) return;
          if (phaseRef.current === 'waiting') setPhase('speaking');
          recorderRef.current.cancel();
          const playback = playAudio(audio);
          playbackRef.current = playback;
          await playback.done;
          playbackRef.current = null;
          if (!isCurrent()) return;
        }
      } catch (error) {
        if (!isCurrent()) return;
        hasFailed = true;
        queue.length = 0;
        if (phaseRef.current === 'speaking' && !then) setPhase('waiting');
        if (!hasSpeechErrorRef.current) {
          hasSpeechErrorRef.current = true;
          toast(
            `${error instanceof Error ? error.message : "Couldn't read the reply aloud."} Replies stay on screen.`,
            'error',
          );
        }
      }
      finish();
    })();

    return {
      add: (text) => {
        if (hasFailed || then || !isCurrent()) return;
        const parts = speechChunks(text, PART_CHARS, hasPlayed ? PART_CHARS : FIRST_PART_CHARS);
        if (!parts.length) return;
        hasPlayed = true;
        if (phaseRef.current === 'waiting') setPhase('speaking');
        for (const part of parts) {
          const audio = synthesize(part, { workspaceId }, abort.signal);
          // An unwatched rejection while an earlier part plays would be reported as unhandled.
          audio.catch(() => undefined);
          queue.push(audio);
        }
        wake?.();
      },
      close: (onDone) => {
        if (then) return;
        then = onDone;
        if (isFinished) finish();
        else wake?.();
      },
      isLive: () => isCurrent() && !then,
      isActive: () => isCurrent() && !isFinished,
    };
  }, [setPhase, stopSpeaking, toast, workspaceId]);

  /** Reads `text` aloud (see `openSpeech`), then calls `then`. */
  const speak = useCallback(
    (text: string, then: () => void): SpeechQueue => {
      const speech = openSpeech();
      if (text.trim()) {
        setPhase('speaking');
        lastSpokenRef.current = text;
      }
      speech.add(text);
      speech.close(then);
      return speech;
    },
    [openSpeech, setPhase],
  );

  const end = useCallback(() => {
    if (phaseRef.current === 'off') return;
    setPhase('off');
    setStartedAt(null);
    stopSpeaking();
    recorderRef.current.cancel();
    displayLevelRef.current = 0;
    lastSpokenRef.current = '';
    setIsHearing(false);
  }, [setPhase, stopSpeaking]);

  const start = useCallback(() => {
    if (phaseRef.current !== 'off') return;
    if (!canRecord()) {
      toast("This browser can't record audio.", 'error');
      return;
    }
    recorderRef.current.cancel();
    isMutedRef.current = false;
    setIsMutedState(false);
    announcedRef.current = null;
    setShowsDebug(readPref(DEBUG_KEY) === 'true');
    setStartedAt(Date.now());
    hasSpeechErrorRef.current = false;
    phaseRef.current = 'starting';
    listen();
  }, [listen, toast]);

  const setMuted = useCallback((muted: boolean) => {
    isMutedRef.current = muted;
    setIsMutedState(muted);
    if (phaseRef.current !== 'listening') return;
    if (muted) {
      recorderRef.current.cancel();
      setIsHearing(false);
    } else if (!reopenRef.current) {
      // (With the speakers still falling silent, the pending reopen opens it.)
      void recorderRef.current.start();
    }
  }, []);

  const setSpeaks = useCallback(
    (speaks: boolean) => {
      setSpeaksReplies(speaks);
      writePref(SPEAK_KEY, String(speaks));
      if (!speaks && phaseRef.current === 'speaking') listen();
      else if (!speaks) stopSpeaking();
    },
    [listen, stopSpeaking],
  );

  /** While speaking: stop and listen now. While listening: end the turn now (if one started). */
  const skip = useCallback(() => {
    if (phaseRef.current === 'speaking') listen();
    else if (phaseRef.current === 'listening' && recorderRef.current.state === 'recording') {
      setIsHearing(false);
      setPhase('transcribing');
      recorderRef.current.stop();
    }
  }, [listen, setPhase]);

  // Listening: a turn starts with real speech (not noise) and ends after a pause; a turn that
  // turns out to be noise is dropped without sending, and a long silence starts over.
  const recorderState = recorder.state;
  useEffect(() => {
    if (phase !== 'listening' || recorderState !== 'recording') return;
    const analyser = recorderRef.current.analyserRef.current;
    if (!analyser) return;
    const detector = createTurnDetector(Date.now());
    const bins = new Float32Array(analyser.frequencyBinCount);
    const sampleRate = analyser.context.sampleRate;
    let wasHearing = false;
    const timer = window.setInterval(() => {
      analyser.getFloatFrequencyData(bins);
      const features = frameFeatures(bins, sampleRate, analyser.fftSize);
      const signal = detector.push(features, Date.now());
      if (debugRef.current) {
        const floor = detector.floorDb;
        debugRef.current.textContent = [
          `level ${features.levelDb.toFixed(1)} dB`,
          `floor ${floor === null ? '–' : floor.toFixed(1)} dB`,
          `needs > ${Math.max(VAD.minLevelDb, (floor ?? VAD.minLevelDb) + VAD.snrDb).toFixed(1)}`,
          `band ${features.bandShare.toFixed(2)} (≥ ${VAD.minBandShare})`,
          `flat ${features.flatness.toFixed(2)} (≤ ${VAD.maxFlatness})`,
          detector.lastIsSpeech ? 'SPEECH' : '',
        ].join(' · ');
      }
      if (detector.isInTurn !== wasHearing) {
        wasHearing = detector.isInTurn;
        setIsHearing(wasHearing);
      }
      if (signal === 'continue') return;
      window.clearInterval(timer);
      setIsHearing(false);
      if (signal === 'end') {
        setPhase('transcribing');
        recorderRef.current.stop();
      } else {
        // Noise, or a long silence: throw the recording away and listen afresh.
        recorderRef.current.cancel();
        void recorderRef.current.start();
      }
    }, CHECK_MS);
    return () => window.clearInterval(timer);
  }, [phase, recorderState, setPhase]);

  // The bar's waveform level.
  useEffect(() => {
    if (phase === 'off') return;
    const timer = window.setInterval(() => {
      if (phase === 'listening') displayLevelRef.current = recorderRef.current.levelRef.current;
      else if (phase === 'speaking') displayLevelRef.current = playbackRef.current?.level() ?? 0;
      else displayLevelRef.current = 0;
    }, 35);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Waiting: announce a question or approval once, then read the answer when the run ends.
  const lastTurn = state.turns.at(-1);
  const pendingApproval =
    lastTurn?.role === 'agent'
      ? lastTurn.flow.find((item) => item.kind === 'approval' && item.state === 'pending')
      : undefined;
  const attention = state.question
    ? `q:${state.question.id}`
    : pendingApproval?.kind === 'approval'
      ? `a:${pendingApproval.approvalId}`
      : null;
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'speaking') return;
    if (isBusy) sawBusyRef.current = true;
    if (attention && attention !== announcedRef.current) {
      announcedRef.current = attention;
      const words = attention.startsWith('q:')
        ? `I have a question for you. ${speakableText(state.question?.question ?? '', 200)} Answer it on screen.`
        : 'I need your approval to continue. Check the screen.';
      // Back to waiting once said: the run goes on after the user acts on screen.
      announcingRef.current = speak(words, () => {
        if (phaseRef.current === 'speaking') setPhase('waiting');
      });
      return;
    }
    // Only this message's reply: a render that still shows the chat from before the send
    // (its last turn being the previous answer) waits for the next one.
    if (state.turns.length <= turnsAtSendRef.current || lastTurn?.role !== 'agent') return;
    const reply = replyRef.current;

    // While it streams, read what the agent wrote to be heard (its <spoken> progress notes and
    // the spoken start of its answer), each finished sentence as soon as it's there (not over a
    // question or approval being announced: what came meanwhile is read after it). The rest of
    // the reply stays on screen. A reply with no <spoken> part is read once it ends (below).
    if (speaksRef.current && !announcingRef.current?.isActive()) {
      for (const item of lastTurn.flow) {
        if (item.kind !== 'text' || item.isError) continue;
        const said = reply.said.get(item.key) ?? '';
        const now = spokenSoFar(item.text, !item.isOpen) ?? '';
        const fresh = unsaid(said, now);
        if (fresh || now.startsWith(said)) reply.said.set(item.key, now);
        if (!fresh) continue;
        if (!reply.speech?.isLive()) reply.speech = openSpeech();
        reply.speech.add(fresh);
        reply.spoken = `${reply.spoken} ${fresh}`.trim();
        lastSpokenRef.current = reply.spoken;
      }
    }

    // The run ended: listen again once all of the reply was read.
    if (isBusy || !sawBusyRef.current) return;
    // Something else is being said (a question or approval): wait until it's done.
    if (phase === 'speaking' && !reply.speech?.isLive()) return;
    sawBusyRef.current = false;
    if (!speaksRef.current) {
      listen();
      return;
    }
    // An answer with no <spoken> part (the model didn't follow the voice note): read its
    // cleaned-up text, after any progress notes still playing.
    const isAnswerSpoken = lastTurn.flow.some(
      (item) =>
        item.kind === 'text' &&
        !item.isInterim &&
        !item.isError &&
        spokenSoFar(item.text, true) !== null,
    );
    const fallback = isAnswerSpoken ? '' : speakableText(answerText(lastTurn));
    if (reply.speech?.isLive()) {
      if (fallback) {
        reply.speech.add(fallback);
        reply.spoken = `${reply.spoken} ${fallback}`.trim();
        lastSpokenRef.current = reply.spoken;
      }
      reply.speech.close(listen);
      return;
    }
    if (fallback) {
      speak(fallback, listen);
      return;
    }
    if (reply.spoken) {
      listen();
      return;
    }
    speak('Done. The result is on screen.', listen);
  }, [
    phase,
    isBusy,
    attention,
    lastTurn,
    state.turns.length,
    state.question,
    speak,
    openSpeech,
    listen,
    setPhase,
  ]);

  // A send that never started a run (it was refused): listen again rather than wait forever.
  useEffect(() => {
    if (phase !== 'waiting' || isBusy) return;
    const timer = window.setTimeout(() => {
      if (phaseRef.current === 'waiting' && !sawBusyRef.current) listen();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [phase, isBusy, listen]);

  // Another chat opened: end it (a new chat getting its id is the same conversation).
  const chatKeyRef = useRef(chatKey);
  useEffect(() => {
    const previous = chatKeyRef.current;
    chatKeyRef.current = chatKey;
    if (previous !== chatKey && previous !== 'new') end();
  }, [chatKey, end]);

  // Esc ends it (unless a question has the keyboard: there Esc skips the question).
  useEffect(() => {
    if (phase === 'off') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || state.question) return;
      event.preventDefault();
      end();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, state.question, end]);

  // Leaving the page stops the voice.
  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  return {
    phase,
    isOn: phase !== 'off',
    isMuted,
    isHearing,
    speaksReplies,
    startedAt,
    levelRef: displayLevelRef,
    showsDebug,
    debugRef,
    start,
    end,
    skip,
    setMuted,
    setSpeaksReplies: setSpeaks,
  };
}

export type VoiceMode = ReturnType<typeof useVoiceMode>;
