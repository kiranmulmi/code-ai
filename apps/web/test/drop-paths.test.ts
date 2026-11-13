// Offline tests for what the message box inserts when files or folders are dropped on it.
// Run with: npm run test -w @app/web
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absolutePath, droppedPathsText, quoteIfSpaced } from '../src/lib/dragPath';

const paths: Record<string, string> = {
  'SKILL.md': '/Users/kiran/.claude/skills/corporate-navy-teal/SKILL.md',
  assets: '/Users/kiran/.claude/skills/corporate-navy-teal/assets',
  'My Notes.md': '/Users/kiran/Documents/My Notes.md',
};
const desktop = (file: { name: string }) => paths[file.name] ?? null;

test('dropped files and folders become their full paths, separated by spaces', () => {
  const { text, missing } = droppedPathsText([{ name: 'SKILL.md' }, { name: 'assets' }], desktop);
  assert.equal(
    text,
    '/Users/kiran/.claude/skills/corporate-navy-teal/SKILL.md /Users/kiran/.claude/skills/corporate-navy-teal/assets',
  );
  assert.deepEqual(missing, []);
});

test('a path with a space is quoted, so where it ends stays clear', () => {
  assert.equal(
    droppedPathsText([{ name: 'My Notes.md' }], desktop).text,
    '"/Users/kiran/Documents/My Notes.md"',
  );
  assert.equal(quoteIfSpaced('/a/b.md'), '/a/b.md');
});

test('without a full path (a browser), only the name goes in, and it is reported', () => {
  const { text, missing } = droppedPathsText([{ name: 'report.pdf' }], () => null);
  assert.equal(text, 'report.pdf');
  assert.deepEqual(missing, ['report.pdf']);
});

test('a Files panel row carries its absolute path', () => {
  assert.equal(
    absolutePath('/Users/kiran/project/', 'src/app.ts'),
    '/Users/kiran/project/src/app.ts',
  );
});
