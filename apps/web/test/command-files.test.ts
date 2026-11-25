import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCommandFiles, parseCommandFiles } from '@app/shared';
import { commandFilesSummary } from '../src/features/chat/tools';

const result = (lines: string[]) =>
  ['$ sed -i s/a/b/ x.ts', 'exit code 0 · 0.1s', ...lines].join('\n') + '\n\n(no output)';

test('the files a run_command lists come back from its result', () => {
  const lines = formatCommandFiles(
    [
      { path: 'src/a.ts', change: 'modified' },
      { path: 'new file.md', change: 'added' },
      { path: 'old.txt', change: 'deleted' },
    ],
    ['README.md'],
  );
  const files = parseCommandFiles(result(lines));
  assert.deepEqual(files.changed, [
    { path: 'src/a.ts', change: 'modified' },
    { path: 'new file.md', change: 'added' },
    { path: 'old.txt', change: 'deleted' },
  ]);
  assert.deepEqual(files.read, ['README.md']);
  assert.equal(commandFilesSummary(files), '3 changed · 1 read');
});

test('a result without file lines lists none, even if its output looks like one', () => {
  const files = parseCommandFiles(
    '$ echo hi\nexit code 0 · 0.0s\n\nfiles changed: M fake.ts\nfiles read: fake.ts',
  );
  assert.deepEqual(files, { changed: [], read: [], moreChanged: 0, moreRead: 0 });
  assert.equal(commandFilesSummary(files), '');
});

test('long lists are cut, with a count of the rest', () => {
  const many = Array.from({ length: 15 }, (_, i) => `f${i}.ts`);
  const files = parseCommandFiles(
    result(
      formatCommandFiles(
        many.map((path) => ({ path, change: 'added' as const })),
        [],
      ),
    ),
  );
  assert.equal(files.changed.length, 12);
  assert.equal(files.moreChanged, 3);
  assert.equal(commandFilesSummary(files), '15 files changed');
  assert.equal(
    commandFilesSummary(parseCommandFiles(result(formatCommandFiles([], ['a.ts'])))),
    '1 file read',
  );
});
