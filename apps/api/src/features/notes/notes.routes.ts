import { Router } from 'express';
import { noteInputSchema } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { NotesService } from './notes.service.js';

/** `/v1/workspaces/:workspaceId/notes`: the Notes tab. */
export function notesRouter(notes: NotesService): Router {
  const router = Router();
  const base = '/workspaces/:workspaceId/notes';

  router.get(
    base,
    asyncHandler(async (req, res) => {
      res.json({ data: await notes.list(param(req, 'workspaceId')) });
    }),
  );

  router.post(
    base,
    asyncHandler(async (req, res) => {
      const input = parse(noteInputSchema, req.body);
      res.status(201).json({ data: await notes.create(param(req, 'workspaceId'), input) });
    }),
  );

  router.get(
    `${base}/:noteId`,
    asyncHandler(async (req, res) => {
      res.json({ data: await notes.get(param(req, 'workspaceId'), param(req, 'noteId')) });
    }),
  );

  router.put(
    `${base}/:noteId`,
    asyncHandler(async (req, res) => {
      const input = parse(noteInputSchema, req.body);
      const saved = await notes.update(param(req, 'workspaceId'), param(req, 'noteId'), input);
      res.json({ data: saved });
    }),
  );

  router.delete(
    `${base}/:noteId`,
    asyncHandler(async (req, res) => {
      await notes.remove(param(req, 'workspaceId'), param(req, 'noteId'));
      res.status(204).end();
    }),
  );

  return router;
}
