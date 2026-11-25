// Skills the user wrote for a workspace (kept by @app/db in its .code-ai/<workspace>/skills/). The
// agent lists them in its system prompt and loads one with use_skill when a task matches;
// skills the user picked for a message come with that message (pickedSkillsContext). A skill
// uploaded as a folder has files of its own (references, templates, assets): use_skill lists
// them and read_skill_file / copy_skill_file reach them, since the file tools can't.
import type { Skill } from '@app/shared';

export interface SkillStore {
  /** Every skill, by name. A broken file is left out rather than failing the run. */
  list(): Promise<Skill[]>;
  /** null when there is no skill with that name. */
  get(name: string): Promise<Skill | null>;
  /**
   * The bytes of one of a folder skill's files (`path` relative to its folder, as listed in
   * `Skill.files`). null when there is no such file. Left out: the store keeps no files.
   */
  readFile?(name: string, path: string): Promise<Buffer | null>;
}
