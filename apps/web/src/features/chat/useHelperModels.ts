import { useCallback, useEffect } from 'react';
import {
  DEFAULT_SPEECH_MODEL,
  DEFAULT_SPEECH_VOICE,
  type Workspace,
  type WorkspaceVoiceInput,
} from '@app/shared';
import { useAsync, type AsyncResource } from '../../lib/useAsync';
import { fetchSettings, onSettingsSaved, saveSettings } from '../settings/api';
import { updateWorkspace } from '../workspaces/api';
import { announceWorkspaceSaved } from '../workspaces/workspaceEvents';

/**
 * The voice and image models next to the chat's own, picked from the composer:
 * - voice: the workspace's speech server (Workspace settings → Voice), null when voice is off;
 * - image: the model that looks at images for chat models that can't (Settings → Agent).
 * Choosing one saves it where those settings live, so the settings pages show it too.
 */
export function useHelperModels(workspaceId: string, workspace: AsyncResource<Workspace>) {
  const settings = useAsync(fetchSettings);
  const { setData: setSettings, reload: reloadSettings } = settings;
  useEffect(() => onSettingsSaved(reloadSettings), [reloadSettings]);
  const { setData: setWorkspace } = workspace;
  const voice = workspace.data?.voice ?? null;

  const chooseVoiceModel = useCallback(
    async (modelId: string | null) => {
      // Picking a server for the first time turns voice on with the usual OpenAI names;
      // they can be changed in Workspace settings → Voice.
      const next: WorkspaceVoiceInput | null = modelId
        ? {
            transcriptionModel: voice?.transcriptionModel ?? 'whisper-1',
            language: voice?.language ?? '',
            speechModel: voice?.speechModel ?? DEFAULT_SPEECH_MODEL,
            speechVoice: voice?.speechVoice ?? DEFAULT_SPEECH_VOICE,
            modelId,
          }
        : null;
      const saved = await updateWorkspace(workspaceId, { voice: next });
      setWorkspace(() => saved);
      announceWorkspaceSaved();
    },
    [workspaceId, voice, setWorkspace],
  );

  const chooseImageModel = useCallback(
    async (modelId: string | null) => {
      // The settings are saved whole: start from the latest, in case they changed elsewhere.
      const current = await fetchSettings();
      const saved = await saveSettings({ ...current, visionModelId: modelId });
      setSettings(() => saved);
    },
    [setSettings],
  );

  return {
    voiceModelId: voice?.modelId ?? null,
    imageModelId: settings.data?.visionModelId ?? null,
    chooseVoiceModel,
    chooseImageModel,
  };
}
