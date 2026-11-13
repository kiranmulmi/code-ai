import { Router } from 'express';
import { z } from 'zod';
import { SKILL_LIMITS, skillInputSchema, skillUploadSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { SkillsService } from './skills.service.js';

const skillFileQuerySchema = z.object({
  path: z.string().min(1, 'Say which file.').max(SKILL_LIMITS.pathLength),
});

export function skillsRouter(skills: SkillsService): Router {
  const router = Router();
  const base = '/workspaces/:workspaceId/skills';

  router.get(
    base,
    asyncHandler(async (req, res) => {
      res.json({ data: await skills.list(param(req, 'workspaceId')) });
    }),
  );

  router.post(
    base,
    asyncHandler(async (req, res) => {
      const input = parse(skillInputSchema, req.body);
      res.status(201).json({ data: await skills.create(param(req, 'workspaceId'), input) });
    }),
  );

  /**
   * A skill folder: `{ files: [{ path, data }], replace? }`, data in base64, SKILL.md at its top
   * (paths may start with the folder's name). Answers 201 with the Skill; 409 if the name is
   * taken and `replace` is off.
   */
  router.post(
    `${base}/upload`,
    asyncHandler(async (req, res) => {
      const input = parse(skillUploadSchema, req.body);
      res.status(201).json({ data: await skills.upload(param(req, 'workspaceId'), input) });
    }),
  );

  router.get(
    `${base}/:name`,
    asyncHandler(async (req, res) => {
      res.json({ data: await skills.get(param(req, 'workspaceId'), param(req, 'name')) });
    }),
  );

  /** One of a folder skill's files (`?path=references/tokens.md`), always as bytes to download. */
  router.get(
    `${base}/:name/file`,
    asyncHandler(async (req, res) => {
      const { path } = parse(skillFileQuerySchema, req.query);
      const bytes = await skills.file(param(req, 'workspaceId'), param(req, 'name'), path);
      // Sent as bytes, so an uploaded HTML or SVG file never runs as a page.
      res
        .set({
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.split('/').pop() ?? 'file')}`,
          'Cache-Control': 'no-store',
        })
        .send(bytes);
    }),
  );

  /** Saves the skill; a different `name` in the body renames it (409 if that name is taken). */
  router.put(
    `${base}/:name`,
    asyncHandler(async (req, res) => {
      const input = parse(skillInputSchema, req.body);
      const skill = await skills.update(param(req, 'workspaceId'), param(req, 'name'), input);
      res.json({ data: skill });
    }),
  );

  router.delete(
    `${base}/:name`,
    asyncHandler(async (req, res) => {
      await skills.remove(param(req, 'workspaceId'), param(req, 'name'));
      res.status(204).end();
    }),
  );

  return router;
}
