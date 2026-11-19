import fs from 'node:fs/promises';
import { defineTool } from '../define.js';
import { assertNotSecretFile } from '../../guardrails.js';
import { isBinary, locate } from './walk.js';
import { TOOL_LIMITS } from '@app/shared';

const MAX_FILE_BYTES = TOOL_LIMITS.readFile.maxFileBytes;
/** Kept under the tool output limit, so a long file is cut at a line, with a note. */
const MAX_CHARS = TOOL_LIMITS.readFile.partChars;
/** Longer lines (minified code, data) are cut: they cost many tokens and rarely help. */
const MAX_LINE_CHARS = TOOL_LIMITS.readFile.maxLineChars;

export const readFile = defineTool<{ path: string; start_line?: number; end_line?: number }>({
  name: 'read_file',
  isReadOnly: true,
  description:
    'Read a text file in the workspace folder (before changing it, too). Long files come in parts; continue with start_line. When you know which lines you need (from search_files), read just those.',
  properties: {
    path: { type: 'string', description: 'File path relative to the workspace folder.' },
    start_line: { type: 'integer', description: 'First line to read (1-based). Default 1.' },
    end_line: {
      type: 'integer',
      description: 'Last line to read, inclusive. Default: as far as fits.',
    },
  },
  optional: ['start_line', 'end_line'],
  async run({ path: file, start_line: startLine, end_line: endLine }, ctx) {
    const { target, shown } = await locate(ctx, file);
    assertNotSecretFile(shown);
    const stat = await fs.stat(target);
    if (stat.isDirectory()) throw new Error(`"${shown}" is a folder; use list_files instead.`);
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(
        `"${shown}" is ${stat.size} bytes, too large to read. Use search_files to find the part you need.`,
      );
    }
    const buffer = await fs.readFile(target);
    if (isBinary(buffer)) return `"${shown}" is a binary file (${stat.size} bytes).`;

    const lines = buffer.toString('utf8').split('\n');
    const first = Math.max(startLine ?? 1, 1);
    if (first > lines.length) {
      throw new Error(`"${shown}" has ${lines.length} lines; start_line ${first} is past the end.`);
    }
    const last = Math.min(endLine ?? lines.length, lines.length);
    const shownLines: string[] = [];
    let chars = 0;
    for (let i = first - 1; i < last; i += 1) {
      const full = lines[i] ?? '';
      const line =
        full.length > MAX_LINE_CHARS
          ? `${full.slice(0, MAX_LINE_CHARS)}… [line cut: ${full.length - MAX_LINE_CHARS} more characters]`
          : full;
      if (chars + line.length > MAX_CHARS && shownLines.length > 0) break;
      shownLines.push(line);
      chars += line.length + 1;
    }
    const until = first + shownLines.length - 1;
    const text = shownLines.join('\n');
    if (first === 1 && until === lines.length) return text;
    const more = until < lines.length ? ` Continue with start_line ${until + 1}.` : '';
    return `[${shown}: lines ${first}-${until} of ${lines.length}.${more}]\n${text}`;
  },
});
