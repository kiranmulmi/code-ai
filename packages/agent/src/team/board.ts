// The team notes: a board one request's agents share. The main agent and every sub-agent it
// starts in that request post findings to it and read each other's, so a writer or reviewer
// can build on what a researcher found without it all passing through one report. It lives
// in memory for the request only; nothing is saved.

export interface BoardNote {
  /** 1, 2, 3… in the order posted */
  id: number;
  /** "main agent" or the sub-agent's label */
  author: string;
  /** a short topic to find it by, e.g. "pricing" */
  topic: string;
  text: string;
}

export const BOARD_LIMITS = {
  notes: 200,
  noteChars: 4000,
  topicChars: 60,
} as const;

export class Board {
  readonly #notes: BoardNote[] = [];

  post(author: string, topic: string, text: string): BoardNote {
    const body = text.trim();
    if (!body) throw new Error('The note is empty.');
    if (this.#notes.length >= BOARD_LIMITS.notes) {
      throw new Error('The team notes are full. Put the rest in your final report.');
    }
    const note: BoardNote = {
      id: this.#notes.length + 1,
      author,
      topic: topic.trim().slice(0, BOARD_LIMITS.topicChars) || 'general',
      text: body.slice(0, BOARD_LIMITS.noteChars),
    };
    this.#notes.push(note);
    return note;
  }

  /** Notes on a topic (case-insensitive, matching part of it) or all; after `afterId` only. */
  read({ topic = '', afterId = 0 }: { topic?: string; afterId?: number } = {}): BoardNote[] {
    const wanted = topic.trim().toLowerCase();
    return this.#notes.filter(
      (note) => note.id > afterId && (!wanted || note.topic.toLowerCase().includes(wanted)),
    );
  }

  get size(): number {
    return this.#notes.length;
  }
}

export function renderNotes(notes: readonly BoardNote[]): string {
  return notes.map((n) => `#${n.id} [${n.topic}] by ${n.author}:\n${n.text}`).join('\n\n');
}
