import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FolderEntry } from '@app/shared';
import {
  compactRow,
  foldersToShow,
  isVisible,
  parentOf,
  soleFolder,
  withoutFolder,
  withoutOpenFolder,
  withParents,
  type FolderState,
} from '../src/features/panel/files/folderTree';

const folder = (path: string, extra: Partial<FolderEntry> = {}): FolderEntry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  kind: 'folder',
  ...extra,
});
const state = (entries: FolderEntry[], total = entries.length): FolderState => ({
  entries,
  total,
  isLoading: false,
  error: null,
});

test('paths: parents, the folder a path is in, and what to open to show it', () => {
  assert.deepEqual(withParents('a/b/c'), ['a', 'a/b', 'a/b/c']);
  assert.deepEqual(withParents(''), []);
  assert.equal(parentOf('a/b/c.ts'), 'a/b');
  assert.equal(parentOf('top.ts'), '');
  assert.deepEqual(foldersToShow('a/b/c.ts', false), ['a', 'a/b']);
  assert.deepEqual(foldersToShow('a/b', true), ['a', 'a/b']);
  assert.ok(isVisible('top.ts', new Set()));
  assert.ok(isVisible('a/b/c.ts', new Set(['a', 'a/b'])));
  assert.ok(!isVisible('a/b/c.ts', new Set(['a/b'])));
});

test('a chain of only-child folders shows as one row, stopping at generated ones', () => {
  const folders = {
    src: state([folder('src/main')]),
    'src/main': state([folder('src/main/java')]),
    'src/main/java': state([folder('src/main/java/App.java', { kind: 'file' })]),
    pkg: state([folder('pkg/node_modules', { isGenerated: true })]),
  };
  assert.deepEqual(compactRow(folder('src'), folders), {
    path: 'src/main/java',
    name: 'src/main/java',
    chain: ['src', 'src/main', 'src/main/java'],
  });
  // node_modules is never opened by itself, so it keeps its own row.
  assert.equal(compactRow(folder('pkg'), folders).path, 'pkg');
  // Not read yet: just the folder.
  assert.equal(compactRow(folder('docs'), folders).name, 'docs');
  // One entry shown of many (a page) isn't an only child.
  assert.equal(soleFolder(state([folder('x/y')], 3)), null);
});

test('forgetting a folder drops everything under it, not its look-alikes', () => {
  const record = { a: 1, 'a/b': 2, ab: 3, 'a/b/c': 4 };
  assert.deepEqual(withoutFolder(record, 'a'), { ab: 3 });
  assert.deepEqual([...withoutOpenFolder(new Set(['a', 'a/b', 'ab']), 'a')], ['ab']);
});
