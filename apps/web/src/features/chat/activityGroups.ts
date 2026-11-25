import type { Section } from './flowSections';
import type { ToolItem } from './conversation';

/**
 * A turn as the chat draws it: the work the agent did on the way (tool calls, plan steps,
 * narration, notes) gathered into activity cards, and what stands on its own between them
 * (the answer, an error, an approval the user must decide).
 */
export type Group =
  | { kind: 'activity'; key: string; sections: Section[] }
  | { kind: 'standalone'; key: string; section: Section };

/** Sections the reader should see outside the folded work log. */
function standsAlone(section: Section): boolean {
  if (section.kind === 'approval') return true;
  if (section.kind === 'text') return section.isError || !section.isInterim;
  return false;
}

export function activityGroups(sections: readonly Section[]): Group[] {
  const groups: Group[] = [];
  for (const section of sections) {
    if (standsAlone(section)) {
      groups.push({ kind: 'standalone', key: section.key, section });
      continue;
    }
    const last = groups.at(-1);
    if (last?.kind === 'activity') last.sections.push(section);
    else groups.push({ kind: 'activity', key: `activity:${section.key}`, sections: [section] });
  }
  return groups;
}

/** Everything a work log's header sums up: its tool calls, steps and how they went. */
export type ActivityStats = {
  tools: ToolItem[];
  failed: number;
  steps: number;
  /** "Thought for…" time when that's all it holds */
  thoughtMs: number | null;
};

export function activityStats(sections: readonly Section[]): ActivityStats {
  const tools: ToolItem[] = [];
  let steps = 0;
  let thoughtMs: number | null = null;
  const visit = (section: Section) => {
    if (section.kind === 'section') {
      steps += 1;
      section.blocks.forEach(visit);
    } else if (section.kind === 'tools') {
      tools.push(...section.items);
    } else if (section.kind === 'thought' && section.durationMs !== null) {
      thoughtMs = (thoughtMs ?? 0) + section.durationMs;
    }
  };
  sections.forEach(visit);
  return {
    tools,
    failed: tools.filter((tool) => tool.state === 'error').length,
    steps,
    thoughtMs,
  };
}
