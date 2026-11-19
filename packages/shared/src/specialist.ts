import { z } from 'zod';
import { AGENT_LIMITS } from './constants.js';
import { TOOL_GROUPS, type ToolGroup } from './workspace.js';

/**
 * A specialist sub-agent the main agent can hand work to with delegate_task. The app has
 * built-in ones (researcher, coder, reviewer, writer, general); a workspace adds its own in the
 * Agents tab, kept as `.hamro-ai/<workspace>/agents/<name>.md` (front matter, then the role). One named
 * like a built-in replaces it.
 */
export interface SpecialistInfo {
  /** kebab-case, also the file name: "security-auditor" */
  name: string;
  /** when to use it: the main agent picks by this */
  description: string;
  /** its role, added to its system prompt (Markdown); empty for none */
  instructions: string;
  /** the tool groups it may use (a workspace's off groups stay off) */
  toolGroups: ToolGroup[];
  /** only tools that change nothing */
  readOnly: boolean;
  /** the model it runs on: Settings → Agent's sub-agent model, or the reviewer's */
  model: SpecialistModel;
  /** built in: the app's own, can't be edited (a workspace file with its name replaces it) */
  isBuiltIn: boolean;
  /** a workspace file named like a built-in, which it replaces */
  replacesBuiltIn?: boolean;
  /** when its file last changed (ISO); null for built-ins */
  updatedAt: string | null;
}

export const SPECIALIST_MODELS = ['subagent', 'review'] as const;
export type SpecialistModel = (typeof SPECIALIST_MODELS)[number];

/** A file in the agents folder that couldn't be used, and why: shown in the Agents tab. */
export interface AgentFileProblem {
  /** the file name, e.g. "security_auditor.md" */
  file: string;
  problem: string;
}

/** `GET /v1/workspaces/:id/agents`: every specialist the agent can pick, and broken files. */
export interface SpecialistList {
  /** the workspace's own first (by name), then the built-ins they don't replace */
  specialists: SpecialistInfo[];
  problems: AgentFileProblem[];
}

/** Lower-case words joined by single hyphens: safe as a file name everywhere. */
export const AGENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `POST /v1/workspaces/:id/agents` and `PUT …/agents/:name` (a different `name` renames it). */
export const specialistInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the specialist a name.')
    .max(AGENT_LIMITS.nameLength, `Keep the name to ${AGENT_LIMITS.nameLength} characters.`)
    .regex(
      AGENT_NAME_PATTERN,
      'Use lower-case letters, digits and single hyphens, e.g. "security-auditor".',
    ),
  description: z
    .string()
    .transform((text) => text.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(1, 'Say when the agent should use it: this is how it picks.')
        .max(
          AGENT_LIMITS.descriptionLength,
          `Keep the description to ${AGENT_LIMITS.descriptionLength} characters.`,
        ),
    ),
  instructions: z
    .string()
    .trim()
    .max(
      AGENT_LIMITS.instructionsChars,
      `Keep the role to ${AGENT_LIMITS.instructionsChars.toLocaleString('en')} characters.`,
    )
    .default(''),
  toolGroups: z
    .array(z.enum(TOOL_GROUPS))
    .min(1, 'Pick at least one tool group.')
    .transform((groups) => TOOL_GROUPS.filter((group) => groups.includes(group))),
  readOnly: z.boolean().default(false),
  model: z.enum(SPECIALIST_MODELS).default('subagent'),
});

export type SpecialistInput = z.input<typeof specialistInputSchema>;
export type SpecialistData = z.output<typeof specialistInputSchema>;

/** A name typed into a field, as a specialist name: "Security Auditor!" → "security-auditor". */
export function toAgentName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, AGENT_LIMITS.nameLength)
    .replace(/-+$/, '');
}
