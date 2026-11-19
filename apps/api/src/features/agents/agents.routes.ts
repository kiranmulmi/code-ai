import { Router } from 'express';
import { specialistInputSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { AgentsService } from './agents.service.js';

/** `/v1/workspaces/:workspaceId/agents`: the Agents tab's specialists. */
export function agentsRouter(agents: AgentsService): Router {
  const router = Router();
  const base = '/workspaces/:workspaceId/agents';

  /** `{ specialists, problems }`: the workspace's own and the built-ins, and broken files. */
  router.get(
    base,
    asyncHandler(async (req, res) => {
      res.json({ data: await agents.list(param(req, 'workspaceId')) });
    }),
  );

  router.post(
    base,
    asyncHandler(async (req, res) => {
      const input = parse(specialistInputSchema, req.body);
      res.status(201).json({ data: await agents.create(param(req, 'workspaceId'), input) });
    }),
  );

  router.get(
    `${base}/:name`,
    asyncHandler(async (req, res) => {
      res.json({ data: await agents.get(param(req, 'workspaceId'), param(req, 'name')) });
    }),
  );

  /** Saves it; a different `name` in the body renames it (409 if that name is taken). */
  router.put(
    `${base}/:name`,
    asyncHandler(async (req, res) => {
      const input = parse(specialistInputSchema, req.body);
      const saved = await agents.update(param(req, 'workspaceId'), param(req, 'name'), input);
      res.json({ data: saved });
    }),
  );

  /** `:name` may be a broken file's own name ("Bad_Name.md"), to clear it out. */
  router.delete(
    `${base}/:name`,
    asyncHandler(async (req, res) => {
      await agents.remove(param(req, 'workspaceId'), param(req, 'name'));
      res.status(204).end();
    }),
  );

  return router;
}
