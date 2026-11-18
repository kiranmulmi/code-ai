import { Router } from 'express';
import {
  workspaceGroupInputSchema,
  workspaceInputSchema,
  workspaceUpdateSchema,
} from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { WorkspacesService } from './workspaces.service.js';

export function workspacesRouter(workspaces: WorkspacesService): Router {
  const router = Router();

  router.get(
    '/workspaces',
    asyncHandler(async (_req, res) => {
      res.json({ data: await workspaces.list() });
    }),
  );

  router.post(
    '/workspaces',
    asyncHandler(async (req, res) => {
      const input = parse(workspaceInputSchema, req.body);
      res.status(201).json({ data: await workspaces.create(input) });
    }),
  );

  // Sidebar folders that collect workspaces (a workspace's groupId files it in one).
  router.get(
    '/workspace-groups',
    asyncHandler(async (_req, res) => {
      res.json({ data: await workspaces.listGroups() });
    }),
  );

  router.post(
    '/workspace-groups',
    asyncHandler(async (req, res) => {
      const input = parse(workspaceGroupInputSchema, req.body);
      res.status(201).json({ data: await workspaces.createGroup(input) });
    }),
  );

  router.patch(
    '/workspace-groups/:groupId',
    asyncHandler(async (req, res) => {
      const input = parse(workspaceGroupInputSchema, req.body);
      res.json({ data: await workspaces.renameGroup(param(req, 'groupId'), input) });
    }),
  );

  router.delete(
    '/workspace-groups/:groupId',
    asyncHandler(async (req, res) => {
      res.json({ data: await workspaces.removeGroup(param(req, 'groupId')) });
    }),
  );

  router.get(
    '/workspaces/:workspaceId',
    asyncHandler(async (req, res) => {
      res.json({ data: await workspaces.get(param(req, 'workspaceId')) });
    }),
  );

  router.patch(
    '/workspaces/:workspaceId',
    asyncHandler(async (req, res) => {
      const changes = parse(workspaceUpdateSchema, req.body);
      res.json({ data: await workspaces.update(param(req, 'workspaceId'), changes) });
    }),
  );

  router.delete(
    '/workspaces/:workspaceId',
    asyncHandler(async (req, res) => {
      res.json({ data: await workspaces.remove(param(req, 'workspaceId')) });
    }),
  );

  return router;
}
