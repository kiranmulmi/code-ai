/** The Customize tab's pages, in nav order. */
export const CUSTOMIZE_SECTIONS = [
  'instructions',
  'skills',
  'agents',
  'tools',
  'mcp',
  'memory',
] as const;

export type CustomizeSection = (typeof CUSTOMIZE_SECTIONS)[number];

export function parseCustomizeSection(stored: string | null): CustomizeSection {
  return CUSTOMIZE_SECTIONS.find((section) => section === stored) ?? 'instructions';
}
