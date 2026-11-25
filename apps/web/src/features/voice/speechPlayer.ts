/**
 * Plays audio the server's text-to-speech model made (mp3), through an `<audio>` element. The
 * browser only plays sound here: it never generates speech itself.
 */
export interface Playback {
  /** Resolves when it has played to the end (or was stopped); rejects if it can't play. */
  done: Promise<void>;
  stop: () => void;
  /** The audio element's output level right now, 0 to 1, for a waveform (0 if unknown). */
  level: () => number;
}

/** Plays `audio` now. */
export function playAudio(audio: Blob): Playback {
  const url = URL.createObjectURL(audio);
  const element = new Audio(url);
  let isStopped = false;
  // The promise's resolvers, so `stop` and a failed `play` can settle it.
  const finish: { resolve: () => void; reject: (error: Error) => void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };

  // The level, from an analyser on the element (best effort: some browsers refuse).
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  try {
    context = new AudioContext();
    const source = context.createMediaElementSource(element);
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyser.connect(context.destination);
  } catch {
    context = null;
    analyser = null;
  }
  const samples = analyser ? new Float32Array(analyser.fftSize) : null;

  const cleanUp = () => {
    element.pause();
    element.removeAttribute('src');
    element.load();
    URL.revokeObjectURL(url);
    void context?.close().catch(() => undefined);
  };

  const done = new Promise<void>((resolve, reject) => {
    finish.resolve = resolve;
    finish.reject = reject;
    element.addEventListener('ended', () => {
      cleanUp();
      resolve();
    });
    element.addEventListener('error', () => {
      cleanUp();
      if (isStopped) resolve();
      else reject(new Error("The spoken reply couldn't be played."));
    });
  });

  void (async () => {
    try {
      if (context?.state === 'suspended') await context.resume();
      await element.play();
    } catch (error) {
      cleanUp();
      if (isStopped) finish.resolve();
      else
        finish.reject(
          error instanceof Error && error.name === 'NotAllowedError'
            ? new Error('The browser blocked audio playback. Click the page and try again.')
            : new Error("The spoken reply couldn't be played."),
        );
    }
  })();

  return {
    done,
    stop: () => {
      if (isStopped) return;
      isStopped = true;
      cleanUp();
      finish.resolve();
    },
    level: () => {
      if (!analyser || !samples || isStopped) return 0;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -60;
      return Math.min(1, Math.max(0, (db + 60) / 60));
    },
  };
}
