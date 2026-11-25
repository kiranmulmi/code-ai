/**
 * Voice mode's speech detector: decides, frame by frame, whether the mic hears a person speaking
 * (not a fan, traffic, a keyboard or a door), and when a spoken turn starts and ends. Pure, so it
 * can be tested offline; `useVoiceMode` feeds it the mic's spectrum every few ms.
 *
 * A frame counts as speech when all of these hold:
 * - the energy in the speech band (300 to 3400 Hz) is well above the room's noise floor, which
 *   is learned while nobody speaks (so a steady hum raises the bar instead of counting);
 * - most of the sound is in that band (a rumble or a hiss is not);
 * - the spectrum is peaky, not flat (voiced speech has harmonics; noise and clicks are flat).
 * A turn starts only after enough speech frames close together, and a turn with too little
 * speech in it (a cough, a bang, a word from the next room) is thrown away, never sent.
 */

/** Tunables, in ms and dB. */
export const VAD = {
  /** the speech band, Hz */
  lowHz: 300,
  highHz: 3400,
  /** a frame is loud enough when its speech-band level is this far over the noise floor */
  snrDb: 10,
  /**
   * ...and over this absolute level (dBFS, mean power per bin), so a silent room's tiny sounds
   * don't count. Low on purpose: browser noise suppression and gain control leave quiet mics
   * well under -62.
   */
  minLevelDb: -70,
  /** the speech band holds at least this share of the energy */
  minBandShare: 0.35,
  /** spectral flatness (0 peaky to 1 flat) at most this */
  maxFlatness: 0.42,
  /**
   * How fast the noise floor may rise, dB per frame: `floorRiseDb` for sound near the floor
   * (the room drifting), `loudRiseDb` for sound well over it that still isn't speech (it may be
   * a voice that failed one test, so it must not lift the floor out of reach).
   */
  floorRiseDb: 0.1,
  loudRiseDb: 0.02,
  /** after a speech frame, the floor doesn't rise for this long (syllable gaps, soft onsets) */
  floorHoldMs: 1500,
  /** the noise floor is learned this long before anything can count (after the mic opens) */
  warmUpMs: 450,
  /** a turn starts with this much speech within `onsetWindowMs` */
  onsetMs: 220,
  onsetWindowMs: 450,
  /** a turn ends after this long without speech */
  silenceMs: 1200,
  /** a turn with less speech than this in total is noise: thrown away */
  minSpeechMs: 550,
  /** a turn ends anyway after this long */
  maxTurnMs: 60_000,
  /** with no turn started for this long, the recording starts over (keeps uploads small) */
  idleRestartMs: 20_000,
} as const;

export type VadOptions = typeof VAD;

/** What one frame of the mic's spectrum says. */
export interface FrameFeatures {
  /** speech-band level, dBFS */
  levelDb: number;
  /** share of the energy in the speech band, 0 to 1 */
  bandShare: number;
  /** spectral flatness of the speech band, 0 (tonal) to 1 (noise) */
  flatness: number;
}

/**
 * Features of one frame from `AnalyserNode.getFloatFrequencyData` (dB per bin, bins of
 * `sampleRate / fftSize` Hz).
 */
export function frameFeatures(
  binsDb: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  options: Pick<VadOptions, 'lowHz' | 'highHz'> = VAD,
): FrameFeatures {
  const hzPerBin = sampleRate / fftSize;
  const low = Math.max(1, Math.floor(options.lowHz / hzPerBin));
  const high = Math.min(binsDb.length - 1, Math.ceil(options.highHz / hzPerBin));
  let total = 0;
  let band = 0;
  let logSum = 0;
  let count = 0;
  for (let index = 1; index < binsDb.length; index += 1) {
    const db = binsDb[index] ?? -Infinity;
    const power = Number.isFinite(db) ? Math.pow(10, db / 10) : 0;
    total += power;
    if (index >= low && index <= high) {
      band += power;
      logSum += Math.log(power + 1e-20);
      count += 1;
    }
  }
  if (!count || band <= 0) return { levelDb: -Infinity, bandShare: 0, flatness: 1 };
  const mean = band / count;
  return {
    levelDb: 10 * Math.log10(mean),
    bandShare: total > 0 ? band / total : 0,
    flatness: Math.min(1, Math.exp(logSum / count) / mean),
  };
}

/**
 * - `continue`: keep listening;
 * - `end`: the user finished a real turn: send it;
 * - `discard`: what was heard wasn't speech after all: drop it and listen again;
 * - `restart`: nothing said for a long while: start a fresh recording.
 */
export type TurnSignal = 'continue' | 'end' | 'discard' | 'restart';

export interface TurnDetector {
  push(features: FrameFeatures, now: number): TurnSignal;
  /** Whether a turn is under way (for the UI: "Hearing you…"). */
  readonly isInTurn: boolean;
  /** The learned noise floor (dBFS), null until the first frame; for the debug readout. */
  readonly floorDb: number | null;
  /** Whether the last frame counted as speech; for the debug readout. */
  readonly lastIsSpeech: boolean;
}

/** A detector for one recording that started at `startedAt` (ms). */
export function createTurnDetector(startedAt: number, options: VadOptions = VAD): TurnDetector {
  let floorDb: number | null = null;
  let lastAt = startedAt;
  /** recent speech frames (time, duration), for the onset window */
  let recent: { at: number; ms: number }[] = [];
  let turnStartedAt: number | null = null;
  let speechMs = 0;
  let lastSpeechAt = 0;
  /** the last frame that counted as speech, for holding the floor */
  let lastVoicedAt = -Infinity;
  let lastIsSpeech = false;

  const learnFloor = (levelDb: number, now: number) => {
    if (!Number.isFinite(levelDb)) return;
    // Quickly down, slowly up: the floor is the quiet the room keeps coming back to.
    if (floorDb === null) floorDb = levelDb;
    else if (levelDb < floorDb) floorDb = floorDb * 0.6 + levelDb * 0.4;
    else if (now - lastVoicedAt >= options.floorHoldMs) {
      // Sound well over the floor rises it only a little: if it was a voice that just missed
      // one test, a fast rise would put the next words out of reach (voice mode stuck on
      // "Listening"). A room that really got louder is still learned, over seconds.
      const isLoud = levelDb - floorDb > options.snrDb / 2;
      const cap = isLoud ? options.loudRiseDb : options.floorRiseDb;
      floorDb += Math.min(cap, (levelDb - floorDb) * 0.05);
    }
  };

  return {
    get isInTurn() {
      return turnStartedAt !== null;
    },
    get floorDb() {
      return floorDb;
    },
    get lastIsSpeech() {
      return lastIsSpeech;
    },
    push({ levelDb, bandShare, flatness }, now) {
      const step = Math.min(200, Math.max(0, now - lastAt));
      lastAt = now;
      if (now - startedAt < options.warmUpMs) {
        learnFloor(levelDb, now);
        return 'continue';
      }
      const floor = floorDb ?? options.minLevelDb;
      const isSpeech =
        levelDb > Math.max(options.minLevelDb, floor + options.snrDb) &&
        bandShare >= options.minBandShare &&
        flatness <= options.maxFlatness;
      lastIsSpeech = isSpeech;
      if (isSpeech) lastVoicedAt = now;

      if (turnStartedAt === null) {
        // Speech dips between syllables, so the onset counts speech within a window, not in a row.
        recent = recent.filter((frame) => now - frame.at <= options.onsetWindowMs);
        if (!isSpeech) {
          learnFloor(levelDb, now);
          return now - startedAt >= options.idleRestartMs ? 'restart' : 'continue';
        }
        recent.push({ at: now, ms: step });
        const heard = recent.reduce((sum, frame) => sum + frame.ms, 0);
        if (heard < options.onsetMs) return 'continue';
        turnStartedAt = recent[0]?.at ?? now;
        speechMs = heard;
        lastSpeechAt = now;
        return 'continue';
      }

      if (isSpeech) {
        speechMs += step;
        lastSpeechAt = now;
      }
      const isOver =
        now - lastSpeechAt >= options.silenceMs || now - turnStartedAt >= options.maxTurnMs;
      if (!isOver) return 'continue';
      return speechMs >= options.minSpeechMs ? 'end' : 'discard';
    },
  };
}
