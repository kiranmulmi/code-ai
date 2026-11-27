import { Router } from 'express';
import { agentSettingsSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';
import type { AppSettings } from './app-settings.js';

/**
 * `/v1/settings`: the app-wide agent settings (the default for workspaces without their own);
 * `/v1/workspaces/:workspaceId/agent-settings`: one workspace's.
 */
export function settingsRouter(
  settings: AppSettings,
  workspaces: Pick<WorkspacesService, 'require'>,
): Router {
  const router = Router();

  router.get('/settings', (_req, res) => {
    res.json({ data: settings.current });
  });

  router.put(
    '/settings',
    asyncHandler(async (req, res) => {
      res.json({ data: await settings.save(parse(agentSettingsSchema, req.body)) });
    }),
  );

  const workspaceBase = '/workspaces/:workspaceId/agent-settings';

  router.get(
    workspaceBase,
    asyncHandler(async (req, res) => {
      const workspace = await workspaces.require(param(req, 'workspaceId'));
      res.json({ data: await settings.forWorkspace(workspace) });
    }),
  );

  router.put(
    workspaceBase,
    asyncHandler(async (req, res) => {
      const workspace = await workspaces.require(param(req, 'workspaceId'));
      const input = parse(agentSettingsSchema, req.body);
      res.json({ data: await settings.saveForWorkspace(workspace, input) });
    }),
  );

  return router;
}
