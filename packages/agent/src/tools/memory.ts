import { defineTool } from './define.js';

export const remember = defineTool<{ fact: string; replaces: string }>({
  name: 'remember',
  description:
    "Save a lasting fact for future sessions: a preference, a fact about the user or their work, or something they ask you to remember. Never one-off questions, file contents, today's date, search results or anything that only matters now. One fact per topic: if a saved memory covers the topic, pass its id in replaces with the combined fact.",
  properties: {
    fact: {
      type: 'string',
      description: 'One self-contained sentence, e.g. "The user prefers answers in Nepali rupees."',
    },
    replaces: {
      type: 'string',
      description:
        'Id of the saved memory this fact updates (from the saved memories list or recall). Use "" for a new topic.',
    },
  },
  async run({ fact, replaces }, ctx) {
    const text = fact.trim();
    if (!text) throw new Error('The fact is empty.');
    if (replaces.trim()) {
      const entry = await ctx.longTermMemory.update(replaces, text);
      if (!entry) {
        throw new Error(
          `No saved memory has the id "${replaces}". Call recall with "" to see the current ids.`,
        );
      }
      return `Updated memory [id ${entry.id.slice(0, 8)}]: ${entry.fact}`;
    }
    const entry = await ctx.longTermMemory.add(text);
    return `Saved to memory [id ${entry.id.slice(0, 8)}]: ${entry.fact}`;
  },
});

export const recall = defineTool<{ query: string }>({
  name: 'recall',
  isReadOnly: true,
  description:
    'Search long-term memory for facts saved in earlier sessions. Call this when the user refers to something they told you before, or when their preferences would change your answer.',
  properties: {
    query: {
      type: 'string',
      description: 'Keywords to search for. Use "" to list everything saved.',
    },
  },
  async run({ query }, ctx) {
    const found = query.trim()
      ? await ctx.longTermMemory.search(query)
      : await ctx.longTermMemory.all();
    if (!found.length) return query.trim() ? 'No matching memories.' : 'Memory is empty.';
    const lines = found.map(
      (e) => `- [id ${e.id.slice(0, 8)}] ${e.fact} (saved ${(e.createdAt ?? '').slice(0, 10)})`,
    );
    return `${query.trim() ? `Matches for "${query}"` : `All saved memories (${found.length})`}:\n${lines.join('\n')}`;
  },
});

export const forget = defineTool<{ ids: string[]; all: boolean }>({
  name: 'forget',
  description:
    'Delete saved facts when the user asks you to forget or clear them, or says one is wrong. Get ids with recall first, or set all to true to delete everything. The user approves first.',
  properties: {
    ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ids of the facts to delete, as recall shows them. Use [] when all is true.',
    },
    all: { type: 'boolean', description: 'true deletes every saved fact.' },
  },
  needsApproval: true,
  async run({ ids, all }, ctx) {
    const removed = all ? await ctx.longTermMemory.clear() : await ctx.longTermMemory.remove(ids);
    if (!removed.length) {
      return all
        ? 'Memory was already empty.'
        : 'No saved facts matched those ids. Call recall to see the current ids.';
    }
    return `Deleted ${removed.length} fact${removed.length === 1 ? '' : 's'}:\n${removed.map((e) => `- ${e.fact}`).join('\n')}`;
  },
});
