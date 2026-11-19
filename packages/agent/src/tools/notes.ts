// post_note / read_notes: the team notes one request's agents share (team/board.ts). Sent only
// when sub-agents are on, to the main agent and to every sub-agent it starts.
import { renderNotes } from '../team/board.js';
import { defineTool } from './define.js';

export const postNote = defineTool<{ topic: string; text: string }>({
  name: 'post_note',
  description:
    'Post a finding to the team notes, which the main agent and every sub-agent in this request can read. Use it for facts others will build on (sources, figures, file paths, decisions), not for progress chatter. One topic per note; keep it self-contained. The notes last for this request only.',
  properties: {
    topic: {
      type: 'string',
      description: 'A short topic others can look it up by, e.g. "pricing" or "auth module".',
    },
    text: { type: 'string', description: 'The finding, with its sources or paths.' },
  },
  async run({ topic, text }, ctx) {
    if (!ctx.notes) throw new Error('There are no team notes in this request.');
    const note = ctx.notes.board.post(ctx.notes.author, topic, text);
    return `Posted note #${note.id} [${note.topic}].`;
  },
});

export const readNotes = defineTool<{ topic?: string; after_id?: number }>({
  name: 'read_notes',
  isReadOnly: true,
  description:
    'Read the team notes: findings the main agent and sub-agents posted in this request. Read them before starting work others may have done, and before writing up results.',
  properties: {
    topic: {
      type: 'string',
      description: 'Only notes whose topic contains this. Leave out for all.',
    },
    after_id: {
      type: 'integer',
      description: 'Only notes posted after this id, to see what is new. Leave out for all.',
    },
  },
  optional: ['topic', 'after_id'],
  async run({ topic, after_id }, ctx) {
    if (!ctx.notes) throw new Error('There are no team notes in this request.');
    const notes = ctx.notes.board.read({ topic: topic ?? '', afterId: after_id ?? 0 });
    if (!notes.length) return topic ? `No notes on "${topic}".` : 'The team notes are empty.';
    return renderNotes(notes);
  },
});
