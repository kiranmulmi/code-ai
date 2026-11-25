import { useCallback, useEffect, useState } from 'react';
import { micErrorText } from './micPrefs';

export interface Microphone {
  id: string;
  label: string;
}

/**
 * The microphones this browser can use. Browsers hide their names until the page has been
 * allowed to use a microphone once: `askAccess` asks, then lists them again with names.
 */
export function useMicrophones() {
  const isSupported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.enumerateDevices);
  const [mics, setMics] = useState<Microphone[]>([]);
  const [hasLabels, setHasLabels] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!isSupported) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(
        (device) => device.kind === 'audioinput' && device.deviceId !== 'default',
      );
      setHasLabels(inputs.some((device) => device.label !== ''));
      setMics(
        inputs.map((device, index) => ({
          id: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        })),
      );
    } catch {
      setMics([]);
    }
  }, [isSupported]);

  const askAccess = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await reload();
    } catch (cause) {
      setError(micErrorText(cause));
    }
  }, [reload]);

  useEffect(() => {
    if (!isSupported) return;
    void reload();
    navigator.mediaDevices.addEventListener('devicechange', reload);
    return () => navigator.mediaDevices.removeEventListener('devicechange', reload);
  }, [isSupported, reload]);

  return { isSupported, mics, hasLabels, error, askAccess, reload };
}
