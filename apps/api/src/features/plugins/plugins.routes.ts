import { Router } from 'express';
import { pluginInputSchema, pluginTestSchema, pluginWriteSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { PluginsService } from './plugins.service.js';

/**
 * Tool plugins, app-wide (each workspace turns them on like MCP servers):
 * GET/POST /v1/plugins, GET/PUT/DELETE /v1/plugins/:name, POST /v1/plugins/test runs draft
 * code once, POST /v1/plugins/write asks the AI to write or fix the code.
 */
export function pluginsRouter(plugins: PluginsService): Router {
  const router = Router();

  router.get(
    '/plugins',
    asyncHandler(async (_req, res) => {
      res.json({ data: await plugins.list() });
    }),
  );

  router.post(
    '/plugins/test',
    asyncHandler(async (req, res) => {
      res.json({ data: await plugins.test(parse(pluginTestSchema, req.body)) });
    }),
  );

  router.post(
    '/plugins/write',
    asyncHandler(async (req, res) => {
      res.json({ data: await plugins.write(parse(pluginWriteSchema, req.body)) });
    }),
  );

  router.post(
    '/plugins',
    asyncHandler(async (req, res) => {
      res.status(201).json({ data: await plugins.create(parse(pluginInputSchema, req.body)) });
    }),
  );

  router.get(
    '/plugins/:name',
    asyncHandler(async (req, res) => {
      res.json({ data: await plugins.get(param(req, 'name')) });
    }),
  );

  router.put(
    '/plugins/:name',
    asyncHandler(async (req, res) => {
      const input = parse(pluginInputSchema, req.body);
      res.json({ data: await plugins.update(param(req, 'name'), input) });
    }),
  );

  router.delete(
    '/plugins/:name',
    asyncHandler(async (req, res) => {
      await plugins.remove(param(req, 'name'));
      res.status(204).end();
    }),
  );

  return router;
}
