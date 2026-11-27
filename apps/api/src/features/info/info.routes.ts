import { Router } from 'express';
import type { AppInfo } from '@app/shared';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../../lib/async-handler.js';

/** `GET /v1/info[?workspaceId=]`: the approval mode, of that workspace's agent settings if given. */
export function infoRouter({ store, settings }: AppContext): Router {
  const router = Router();

  router.get(
    '/info',
    asyncHandler(async (req, res) => {
      const { workspaceId } = req.query;
      const workspace =
        typeof workspaceId === 'string' && workspaceId
          ? await store.getWorkspace(workspaceId)
          : null;
      const current = workspace ? await settings.forWorkspace(workspace) : settings.current;
      const data: AppInfo = { approval: current.approval };
      res.json({ data });
    }),
  );

  return router;
}
