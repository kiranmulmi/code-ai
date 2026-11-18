// Offline tests for filing workspaces into the sidebar's folders, and searching them.
// Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Workspace, WorkspaceGroup } from '@app/shared';
import { arrangeWorkspaces } from '../src/features/workspaces/workspaceFolders';

const workspace = (id: string, name: string, groupId: string | null, lastActiveAt: string) =>
  ({ id, name, path: `/code/${id}`, groupId, lastActiveAt }) as unknown as Workspace;
const group = (id: string, name: string): WorkspaceGroup => ({ id, name, createdAt: null });

const groups = [group('g-mt', 'MT services'), group('g-sky', 'Sky')];
const workspaces = [
  workspace('beacon', 'MT Beacon Service', 'g-mt', '2025-11-10'),
  workspace('relay', 'MT Relay Service', 'g-mt', '2025-11-12'),
  workspace('sky-demo', 'Sky Demo Preview', 'g-sky', '2025-11-01'),
  workspace('canvix', 'Canvix', null, '2025-11-05'),
  workspace('lost', 'Lost one', 'g-gone', '2025-11-02'),
];

test('workspaces are filed in their folders, most recent first; the rest stay at the top level', () => {
  const { folders, loose, shown } = arrangeWorkspaces(workspaces, groups);
  assert.deepEqual(
    folders.map((f) => [f.group.name, f.workspaces.map((w) => w.id)]),
    [
      ['MT services', ['relay', 'beacon']],
      ['Sky', ['sky-demo']],
    ],
  );
  // A folder that's gone doesn't hide its workspace.
  assert.deepEqual(
    loose.map((w) => w.id),
    ['canvix', 'lost'],
  );
  assert.equal(shown, 5);
});

test('an empty folder still shows', () => {
  const { folders } = arrangeWorkspaces([], [group('g', 'Empty')]);
  assert.equal(folders.length, 1);
  assert.equal(folders[0]?.workspaces.length, 0);
});

test('a search keeps matching workspaces, and a whole folder whose name matches', () => {
  const byWorkspace = arrangeWorkspaces(workspaces, groups, 'beacon');
  assert.deepEqual(
    byWorkspace.folders.map((f) => [f.group.id, f.workspaces.map((w) => w.id)]),
    [['g-mt', ['beacon']]],
  );
  assert.equal(byWorkspace.loose.length, 0);
  assert.equal(byWorkspace.shown, 1);

  const byFolder = arrangeWorkspaces(workspaces, groups, 'sky');
  assert.deepEqual(
    byFolder.folders.map((f) => f.workspaces.map((w) => w.id)),
    [['sky-demo']],
  );

  assert.equal(arrangeWorkspaces(workspaces, groups, 'nothing').shown, 0);
});
