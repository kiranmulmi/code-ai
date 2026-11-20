// Offline tests for the Notes tab's list logic. Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Note } from '@app/shared';
import {
  filterNotes,
  noteLabel,
  notePreview,
  sortNotes,
  withNote,
} from '../src/features/panel/notes/noteList';
import { PANEL_TABS, PANEL_TAB_LABEL, visiblePanelTabs } from '../src/features/panel/panelTabs';

const note = (id: string, updatedAt: string, title = '', body = ''): Note => ({
  id,
  title,
  body,
  createdAt: updatedAt,
  updatedAt,
});

test('Notes is a top panel tab right after Tasks, always shown', () => {
  assert.deepEqual(PANEL_TABS.slice(-2), ['tasks', 'notes']);
  assert.equal(PANEL_TAB_LABEL.notes, 'Notes');
  assert.ok(visiblePanelTabs({ terminal: false, git: false }).includes('notes'));
});

test('the list is newest first, and a saved note replaces its old copy', () => {
  const a = note('a', '2024-01-01T00:00:00.000Z', 'A');
  const b = note('b', '2024-02-01T00:00:00.000Z', 'B');
  assert.deepEqual(
    sortNotes([a, b]).map((n) => n.id),
    ['b', 'a'],
  );
  const editedA = { ...a, updatedAt: '2024-03-01T00:00:00.000Z' };
  assert.deepEqual(
    withNote([b, a], editedA).map((n) => n.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    withNote(null, a).map((n) => n.id),
    ['a'],
  );
});

test('an untitled note is labelled by its first line, without repeating it', () => {
  const untitled = note('x', '2024-01-01T00:00:00.000Z', '', '\n  Buy milk\nand eggs');
  assert.equal(noteLabel(untitled), 'Buy milk');
  assert.equal(notePreview(untitled), 'and eggs');
  assert.equal(noteLabel(note('y', '2024-01-01T00:00:00.000Z')), 'Untitled note');
  assert.equal(notePreview(note('z', '2024-01-01T00:00:00.000Z', 'T', 'a\n b')), 'a b');
});

test('search matches the title or the text, ignoring case', () => {
  const list = [
    note('a', '2024-01-01T00:00:00.000Z', 'Deploy', 'steps'),
    note('b', '2024-01-01T00:00:00.000Z', 'Ideas', 'Try DEPLOY previews'),
    note('c', '2024-01-01T00:00:00.000Z', 'Other', ''),
  ];
  assert.deepEqual(
    filterNotes(list, 'deploy').map((n) => n.id),
    ['a', 'b'],
  );
  assert.equal(filterNotes(list, '  ').length, 3);
});
