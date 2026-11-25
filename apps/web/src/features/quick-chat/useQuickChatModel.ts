import { useEffect, useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import type { ModelProfile } from '@app/shared';
import { useModels } from '../models/useModels';
import { fetchWorkspace } from '../workspaces/api';
import { onWorkspaceSaved } from '../workspaces/workspaceEvents';

/** The id of the workspace open in the address bar, if any (not the "new workspace" form). */
function useOpenWorkspaceId(): string | null {
  const { pathname } = useLocation();
  const id = matchPath('/workspaces/:workspaceId/*', pathname)?.params.workspaceId;
  return id && id !== 'new' ? id : null;
}

/**
 * The model quick chat talks to: the open workspace's "Quick chat model" (Workspace settings →
 * General), else the default model. A model that was deleted falls back to the default too.
 * Null while loading, or when no model is set up.
 */
export function useQuickChatModel(): ModelProfile | null {
  const models = useModels();
  const workspaceId = useOpenWorkspaceId();
  const [wantedId, setWantedId] = useState<string | null>(null);

  useEffect(() => {
    setWantedId(null);
    if (!workspaceId) return;
    let isCurrent = true;
    const load = () => {
      fetchWorkspace(workspaceId)
        .then((workspace) => {
          if (isCurrent) setWantedId(workspace.quickChatModelId);
        })
        .catch(() => {
          // No workspace setting to go by: the default model.
          if (isCurrent) setWantedId(null);
        });
    };
    load();
    const unsubscribe = onWorkspaceSaved(load);
    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, [workspaceId]);

  const list = models.data ?? [];
  return (
    list.find((model) => model.id === wantedId) ??
    list.find((model) => model.isDefault) ??
    list[0] ??
    null
  );
}
