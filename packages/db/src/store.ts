// All storage, so the rest of the app never touches the data files. There is no database:
// the app's own data (the list of workspaces, models, agent settings, MCP servers, mcp.json
// approvals) lives in ~/.code-ai/ (app-home.ts). Everything about one
// workspace (including which MCP servers are on), chats, messages, runs, memory and its
// instructions, lives in the workspace folder under .code-ai/<workspace>/ (workspace-data.ts),
// so several workspaces can share a folder.
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import {
  DEFAULT_DISABLED_TOOLS,
  LIMITS,
  type ChatSettings,
  type McpConfig,
  type McpServerConfig,
  type ToolGroup,
  type Workspace,
  type WorkspaceGroup,
  type WorkspacePlanning,
  workspaceSlug,
} from '@app/shared';
import {
  APP_DATA_FOLDER,
  errorMessage,
  expandHome,
  prepareWorkspaceFolder,
  type ChatMessage,
  type MemoryStore,
} from '@app/agent';
import { DEFAULT_APP_HOME, appHomeFile } from './app-home.js';
import { InputError } from './errors.js';
import { moveFlatWorkspaceData, moveLegacyFolders } from './legacy-folders.js';
import { WorkspaceAttachments } from './attachments.js';
import { WorkspaceSkills } from './workspace-skills.js';
import { WorkspaceAgents } from './workspace-agents.js';
import { WorkspaceNotes } from './workspace-notes.js';
import { McpServerStore } from './mcp-servers.js';
import { PluginStore } from './plugins.js';
import { McpTrust } from './mcp-trust.js';
import { ModelStore } from './models.js';
import { SettingsStore } from './settings.js';
import { WorkspaceMcp } from './workspace-mcp.js';
import { WorkspaceList, type SavedWorkspace, type SavedWorkspaceGroup } from './workspaces.js';
import {
  WorkspaceData,
  isUuid,
  type ChatRecord,
  type RunRecord,
  type SaveRunInput,
} from './workspace-data.js';

export interface Chat extends ChatRecord {
  workspaceId: string;
}

export class Store {
  readonly #appHome: string;
  readonly #workspaces: WorkspaceList;
  /** Which workspace each chat seen so far belongs to, so finding it again is one look. */
  readonly #chatHome = new Map<string, string>();
  readonly #mcpTrust: McpTrust;
  /** The models the agent can run on, shared by every workspace. */
  readonly models: ModelStore;
  /** How the agent behaves (limits, approvals, planning, ...), app-wide. */
  readonly settings: SettingsStore;
  /** MCP servers, set up once for every workspace (each turns them on in `mcp(workspace)`). */
  readonly mcpServers: McpServerStore;
  /** Tool plugins made in the Tools tab (plugins/ in the app home), each also one of `mcpServers`. */
  readonly plugins: PluginStore;

  /** `appHome`: the folder for the app's own settings files (default ~/.code-ai). */
  constructor({ appHome = DEFAULT_APP_HOME }: { appHome?: string } = {}) {
    this.#appHome = appHome;
    this.#workspaces = new WorkspaceList(appHomeFile(appHome, 'workspaces'));
    this.#mcpTrust = new McpTrust(appHomeFile(appHome, 'mcpTrust'));
    this.models = new ModelStore(appHomeFile(appHome, 'models'));
    this.settings = new SettingsStore(appHomeFile(appHome, 'agentSettings'));
    this.mcpServers = new McpServerStore(appHomeFile(appHome, 'mcpServers'));
    this.plugins = new PluginStore(appHome, this.mcpServers);
  }

  // ---------- Workspaces ----------

  async listWorkspaces(): Promise<Workspace[]> {
    const saved = await this.#workspaces.list();
    return Promise.all(saved.map((row) => toWorkspace(row, { withChatCount: true })));
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    const row = await this.#workspaces.get(id);
    return row ? toWorkspace(row) : null;
  }

  async findWorkspaceByName(name: string): Promise<Workspace | null> {
    const wanted = name.toLowerCase();
    const found = (await this.#workspaces.list()).find((w) => w.name.toLowerCase() === wanted);
    return found ? toWorkspace(found) : null;
  }

  /**
   * The folder is created if it doesn't exist yet. Other workspaces may use it too, under
   * names with another slug (workspaceSlug). Data already in its .code-ai/<slug>/ (from a
   * workspace of that name deleted from the list) brings its chats back, as does data in
   * the old layout (right in .code-ai/) when no other workspace uses the folder.
   */
  async createWorkspace({
    name,
    path,
    instructions = '',
    planning = 'default',
    disabledTools = [...DEFAULT_DISABLED_TOOLS],
    voiceMode = false,
    hasTerminalTab = true,
    hasGitTab = true,
  }: {
    name: string;
    path: string;
    instructions?: string;
    planning?: WorkspacePlanning;
    disabledTools?: ToolGroup[];
    voiceMode?: boolean;
    hasTerminalTab?: boolean;
    hasGitTab?: boolean;
  }): Promise<Workspace> {
    const clean = checkName(name);
    const cleanInstructions = checkInstructions(instructions);
    const folder = await checkFolder(path);
    await this.#assertCanUseFolder(folder, clean);
    const isFolderShared = (await this.#workspaces.list()).some((w) => w.path === folder);
    // Data left in the old layout by a workspace deleted from the list: it becomes this one's.
    if (!isFolderShared)
      await moveFlatWorkspaceData([{ path: folder, name: clean }], this.#mcpTrust);
    await new WorkspaceData(folder, clean).writeSettings({
      instructions: cleanInstructions,
      planning,
      disabledTools,
      voiceMode,
      hasTerminalTab,
      hasGitTab,
    });
    return toWorkspace(await this.#workspaces.add(clean, folder));
  }

  /**
   * A new folder or name takes the workspace's chats, memory and settings along with it (the
   * name names its data subfolder).
   */
  async updateWorkspace(
    id: string,
    {
      name,
      path,
      instructions,
      planning,
      disabledTools,
      voiceMode,
      hasTerminalTab,
      hasGitTab,
      groupId,
    }: {
      name?: string;
      path?: string;
      instructions?: string;
      planning?: WorkspacePlanning;
      disabledTools?: ToolGroup[];
      voiceMode?: boolean;
      hasTerminalTab?: boolean;
      hasGitTab?: boolean;
      /** The sidebar folder to file it in; null for the top level. */
      groupId?: string | null;
    },
  ): Promise<Workspace | null> {
    const current = await this.#workspaces.get(id);
    if (!current) return null;
    // Checked first, so a folder that's gone doesn't leave a half-made change.
    if (groupId !== undefined && groupId !== null) await this.#requireGroup(groupId);
    const cleanName = name === undefined ? current.name : checkName(name);
    const cleanInstructions = instructions === undefined ? null : checkInstructions(instructions);
    const folder = path === undefined ? current.path : await checkFolder(path);

    const from = new WorkspaceData(current.path, current.name);
    const to = new WorkspaceData(folder, cleanName);
    const isMoving = to.dir !== from.dir;
    if (isMoving) {
      await this.#assertCanUseFolder(folder, cleanName, current);
      await from.moveTo(folder, cleanName);
    }

    try {
      const settings = {
        ...(cleanInstructions !== null ? { instructions: cleanInstructions } : {}),
        ...(planning !== undefined ? { planning } : {}),
        ...(disabledTools !== undefined ? { disabledTools } : {}),
        ...(voiceMode !== undefined ? { voiceMode } : {}),
        ...(hasTerminalTab !== undefined ? { hasTerminalTab } : {}),
        ...(hasGitTab !== undefined ? { hasGitTab } : {}),
      };
      if (Object.keys(settings).length) await to.writeSettings(settings);
      // Only filing it in a sidebar folder isn't an edit: it keeps its place in the list.
      const isOnlyFiling =
        name === undefined && path === undefined && !Object.keys(settings).length;
      let updated: SavedWorkspace | null = isOnlyFiling
        ? current
        : await this.#workspaces.update(id, { name: cleanName, path: folder });
      if (updated && groupId !== undefined && groupId !== current.groupId) {
        updated = await this.#workspaces.setGroup(id, groupId);
      }
      if (isMoving) await this.#mcpTrust.move(from.dir, to.dir);
      return updated ? toWorkspace(updated) : null;
    } catch (error) {
      // Keep the data where the workspace list says the workspace is.
      if (isMoving) await to.moveTo(current.path, current.name).catch(() => {});
      throw error;
    }
  }

  /**
   * Why `requested` can't be the folder of the workspace `workspaceId` (or of a new one), or
   * null. Checked as the user picks a folder, so nothing is created; saving checks it again
   * along with the rest (absolute, not the disk root or home). Other workspaces using the
   * folder are fine unless their name has the same slug as `name` (the workspace's current
   * name when left out; for a new workspace without one, nothing is checked against them).
   */
  async folderProblem(
    requested: string,
    workspaceId?: string,
    name?: string,
  ): Promise<string | null> {
    const expanded = expandHome(requested.trim());
    if (!nodePath.isAbsolute(expanded)) return null;
    const resolved = nodePath.resolve(expanded);
    const folder = await fs.realpath(resolved).catch(() => resolved);
    const current = workspaceId ? await this.#workspaces.get(workspaceId) : null;
    const wantedName = name?.trim() || current?.name;
    if (!wantedName) return null;
    if (current?.path === folder && workspaceSlug(current.name) === workspaceSlug(wantedName)) {
      return null;
    }
    try {
      await this.#assertCanUseFolder(folder, wantedName, current ?? undefined);
      return null;
    } catch (error) {
      if (error instanceof InputError) return error.message;
      throw error;
    }
  }

  /**
   * No other workspace on the folder may have a name with the same slug. A new workspace
   * takes over data left in its subfolder (by one deleted from the list); one moving or
   * renamed there can't, as its own data would replace it.
   */
  async #assertCanUseFolder(folder: string, name: string, moving?: SavedWorkspace): Promise<void> {
    await this.#workspaces.assertFolderFree(folder, name, moving?.id);
    const target = new WorkspaceData(folder, name);
    if (moving && (await target.exists())) {
      throw new InputError(
        `${folder} already has data for a workspace named like "${name}" (in ${APP_DATA_FOLDER}/${workspaceSlug(name)}). Pick another name or folder, or remove that one first.`,
      );
    }
  }

  /**
   * Deletes the workspace's chats, memory and settings (its .code-ai/<workspace> folder).
   * Its other files, and other workspaces' data in the folder, stay.
   */
  async deleteWorkspace(id: string): Promise<boolean> {
    const row = await this.#workspaces.get(id);
    if (!row) return false;
    const data = new WorkspaceData(row.path, row.name);
    await data.remove();
    await this.#mcpTrust.forget(data.dir);
    return this.#workspaces.remove(id);
  }

  // ---------- Workspace folders (sidebar groups) ----------

  async listWorkspaceGroups(): Promise<WorkspaceGroup[]> {
    return (await this.#workspaces.listGroups()).map(toWorkspaceGroup);
  }

  async createWorkspaceGroup(name: string): Promise<WorkspaceGroup> {
    return toWorkspaceGroup(await this.#workspaces.addGroup(checkGroupName(name)));
  }

  async renameWorkspaceGroup(id: string, name: string): Promise<WorkspaceGroup | null> {
    if (!isUuid(id)) return null;
    const renamed = await this.#workspaces.renameGroup(id, checkGroupName(name));
    return renamed ? toWorkspaceGroup(renamed) : null;
  }

  /** Its workspaces move to the top level; none are deleted. */
  async deleteWorkspaceGroup(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    return this.#workspaces.removeGroup(id);
  }

  async #requireGroup(id: string): Promise<void> {
    const groups = await this.#workspaces.listGroups();
    if (!groups.some((group) => group.id === id)) {
      throw new InputError("That folder doesn't exist any more.");
    }
  }

  // ---------- Chats ----------

  /** The workspace's chats, most recently active first. */
  async listChats(workspaceId: string): Promise<Chat[]> {
    const row = await this.#workspaces.get(workspaceId);
    if (!row) return [];
    const chats = await new WorkspaceData(row.path, row.name).listChats();
    for (const chat of chats) this.#chatHome.set(chat.id, row.id);
    return chats
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .slice(0, 200)
      .map((chat) => ({ ...chat, workspaceId: row.id }));
  }

  async getChat(id: string): Promise<Chat | null> {
    const found = await this.#locateChat(id);
    return found ? { ...found.chat, workspaceId: found.workspaceId } : null;
  }

  async createChat(workspaceId: string, title = 'New chat'): Promise<Chat> {
    const row = await this.#workspaces.get(workspaceId);
    if (!row) throw new Error("That workspace doesn't exist.");
    const chat = await new WorkspaceData(row.path, row.name).createChat(checkTitle(title));
    this.#chatHome.set(chat.id, row.id);
    return { ...chat, workspaceId: row.id };
  }

  async renameChat(id: string, title: string): Promise<Chat | null> {
    const found = await this.#locateChat(id);
    if (!found) return null;
    const renamed = await found.data.updateChat(id, {
      title: checkTitle(title),
      isTitleCustom: true,
    });
    return renamed ? { ...renamed, workspaceId: found.workspaceId } : null;
  }

  /**
   * A title the app wrote (from the model), saved only while the user hasn't renamed the
   * chat. Returns the updated chat, or null when it was renamed, is gone or already has it.
   */
  async setAutoTitle(id: string, title: string): Promise<Chat | null> {
    const found = await this.#locateChat(id);
    if (!found) return null;
    const chat = await found.data.readChat(id);
    if (!chat || chat.isTitleCustom || chat.title === title) return null;
    const updated = await found.data.updateChat(id, { title: checkTitle(title) });
    return updated ? { ...updated, workspaceId: found.workspaceId } : null;
  }

  /**
   * The chat's own composer settings (model, effort, Auto-approve), restored when it's opened
   * again. Doesn't count as activity, so the chat keeps its place in the list.
   */
  async setChatSettings(id: string, settings: ChatSettings): Promise<Chat | null> {
    const found = await this.#locateChat(id);
    if (!found) return null;
    const updated = await found.data.updateChat(id, { settings });
    return updated ? { ...updated, workspaceId: found.workspaceId } : null;
  }

  async deleteChat(id: string): Promise<boolean> {
    const found = await this.#locateChat(id);
    if (!found) return false;
    this.#chatHome.delete(id);
    return found.data.deleteChat(id);
  }

  /** The conversation of a chat, oldest first. */
  async loadMessages(chatId: string): Promise<ChatMessage[]> {
    const found = await this.#locateChat(chatId);
    return found ? found.data.loadMessages(chatId) : [];
  }

  /** Save the end of a request: its messages, the chat's plan and memory state, and its record. */
  async saveRun(chatId: string, input: SaveRunInput): Promise<void> {
    const found = await this.#locateChat(chatId);
    if (!found) throw new Error('That chat no longer exists, so this request was not saved.');
    await found.data.saveRun(chatId, input);
  }

  /** Each request's result in a chat, keyed by the seq of the message that started it. */
  async loadRuns(chatId: string): Promise<Map<number, RunRecord>> {
    const found = await this.#locateChat(chatId);
    return found ? found.data.loadRuns(chatId) : new Map();
  }

  // ---------- Memories ----------

  /** The long-term memory of one workspace: .code-ai/<workspace>/memory.json in its folder. */
  memory(workspace: Pick<Workspace, 'path' | 'name'>): MemoryStore {
    return new WorkspaceData(workspace.path, workspace.name).memory();
  }

  /** Files attached in one workspace's chats: .code-ai/<workspace>/uploads/. */
  attachments(workspace: Pick<Workspace, 'path' | 'name'>): WorkspaceAttachments {
    return new WorkspaceAttachments(workspace.path, workspace.name);
  }

  /** One workspace's skills: .code-ai/<workspace>/skills/<name>.md, or <name>/SKILL.md with its files. */
  skills(workspace: Pick<Workspace, 'path' | 'name'>): WorkspaceSkills {
    return new WorkspaceSkills(workspace.path, workspace.name);
  }

  /** One workspace's own specialist sub-agents: .code-ai/<workspace>/agents/<name>.md. */
  agents(workspace: Pick<Workspace, 'path' | 'name'>): WorkspaceAgents {
    return new WorkspaceAgents(workspace.path, workspace.name);
  }

  /** One workspace's notes (the Notes tab): notes.json in its data folder. */
  notes(workspace: Pick<Workspace, 'path' | 'name'>): WorkspaceNotes {
    return new WorkspaceNotes(workspace.path, workspace.name);
  }

  /** Which MCP servers one workspace turned on: .code-ai/<workspace>/mcp.json, and whether it's approved. */
  mcp(workspace: Pick<Workspace, 'path' | 'name'>): WorkspaceMcp {
    return new WorkspaceMcp(new WorkspaceData(workspace.path, workspace.name), this.#mcpTrust);
  }

  /** Renames an app-wide MCP server; workspaces that use it keep it (on or off) under the new name. */
  async renameMcpServer(from: string, to: string): Promise<void> {
    for (const workspace of await this.listWorkspaces()) {
      const mcp = this.mcp(workspace);
      try {
        if ((await mcp.read()).allowed.includes(from)) await mcp.rename(from, to);
      } catch {
        // A folder that's gone or unreadable: nothing to keep on there.
      }
    }
  }

  /**
   * The app's data folders had other names: move ~/.hamro-ai, ~/.nimbrio-ai, ~/.agentic-ai and
   * each listed workspace's .hamro-ai, .nimbrio-ai and .agentic-ai to the new one; then move a workspace's data kept
   * right in .code-ai/ (before several workspaces could share a folder) into its
   * .code-ai/<workspace>/, with its MCP approval (legacy-folders.ts). Call it on start, before
   * anything reads or writes them. Returns what happened, for the log.
   */
  async moveLegacyFolders(): Promise<string[]> {
    // The app home first: the workspace list may be in an old one.
    const home = await moveLegacyFolders(this.#appHome, []);
    const workspaces = await this.#workspaces.list();
    const renamed = await moveLegacyFolders(
      this.#appHome,
      workspaces.map((row) => row.path),
    );
    const flat = await moveFlatWorkspaceData(workspaces, this.#mcpTrust);
    return [...home, ...renamed, ...flat];
  }

  /**
   * One-time move from per-workspace server settings to the app-wide list. A workspace's old
   * mcp.json is imported only if the user had approved it; its servers are added (a name
   * already taken by different settings gets a suffix) and turned on there as they were.
   * The old file is kept as mcp.imported.json. Returns what happened, for the log.
   */
  async importLegacyMcp(): Promise<string[]> {
    const notes: string[] = [];
    for (const workspace of await this.listWorkspaces()) {
      const data = new WorkspaceData(workspace.path, workspace.name);
      let legacy: McpConfig | null;
      try {
        legacy = await data.readLegacyMcp();
      } catch (error) {
        notes.push(
          `${workspace.name}: the old mcp.json couldn't be read (${errorMessage(error)}).`,
        );
        continue;
      }
      if (!legacy) continue;
      await data.keepLegacyMcp();
      const isApproved = await this.#mcpTrust.isTrusted(data.dir, legacy);
      const enabled: string[] = [];
      if (isApproved) {
        for (const [name, server] of Object.entries(legacy.mcpServers)) {
          const { disabled, ...settings } = server;
          const saved = await this.#importServer(name, settings);
          if (!disabled) enabled.push(saved);
        }
      }
      await this.mcp(workspace).replaceApproved(enabled);
      notes.push(
        isApproved
          ? `${workspace.name}: imported ${Object.keys(legacy.mcpServers).length} MCP server(s), ${enabled.length} on.`
          : `${workspace.name}: its mcp.json was never approved, so its servers weren't imported (kept in mcp.imported.json).`,
      );
    }
    return notes;
  }

  /** Adds an imported server, reusing one with the same settings; returns the name it has. */
  async #importServer(name: string, server: McpServerConfig): Promise<string> {
    for (let n = 1; n < 100; n += 1) {
      const candidate = n === 1 ? name : `${name.slice(0, 29)}_${n}`;
      const existing = await this.mcpServers.get(candidate);
      if (!existing) {
        await this.mcpServers.add(candidate, server);
        return candidate;
      }
      if (JSON.stringify(existing.server) === JSON.stringify(server)) return candidate;
    }
    throw new Error(`Couldn't find a free name for the MCP server "${name}".`);
  }

  // ---------- Internals ----------

  /** The workspace a chat lives in: the remembered one first, then every workspace folder. */
  async #locateChat(
    id: string,
  ): Promise<{ workspaceId: string; data: WorkspaceData; chat: ChatRecord } | null> {
    if (!isUuid(id)) return null;
    const rows = await this.#workspaces.list();
    const remembered = this.#chatHome.get(id);
    const ordered = [...rows].sort(
      (a, b) => Number(b.id === remembered) - Number(a.id === remembered),
    );
    for (const row of ordered) {
      const data = new WorkspaceData(row.path, row.name);
      const chat = await data.readChat(id);
      if (chat) {
        this.#chatHome.set(id, row.id);
        return { workspaceId: row.id, data, chat };
      }
    }
    this.#chatHome.delete(id);
    return null;
  }
}

// ---------- Helpers ----------

async function toWorkspace(
  row: SavedWorkspace,
  { withChatCount = false }: { withChatCount?: boolean } = {},
): Promise<Workspace> {
  const data = new WorkspaceData(row.path, row.name);
  const { instructions, planning, disabledTools, voiceMode, hasTerminalTab, hasGitTab } =
    await data.readSettings();
  return {
    id: row.id,
    name: row.name,
    instructions,
    planning,
    disabledTools,
    voiceMode,
    hasTerminalTab,
    hasGitTab,
    path: row.path,
    groupId: row.groupId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(withChatCount
      ? {
          chatCount: await data.countChats(),
          lastActiveAt: (await data.lastChatActivity()) ?? row.updatedAt,
        }
      : {}),
  };
}

function toWorkspaceGroup(row: SavedWorkspaceGroup): WorkspaceGroup {
  return { id: row.id, name: row.name, createdAt: row.createdAt };
}

function checkGroupName(name: unknown): string {
  const clean = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) throw new InputError('Give the folder a name.');
  if (clean.length > LIMITS.workspaceName) {
    throw new InputError(`Keep the name under ${LIMITS.workspaceName} characters.`);
  }
  return clean;
}

function checkName(name: unknown): string {
  const clean = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) throw new InputError('Give the workspace a name.');
  if (clean.length > LIMITS.workspaceName) {
    throw new InputError(`Keep the name under ${LIMITS.workspaceName} characters.`);
  }
  return clean;
}

function checkTitle(title: unknown): string {
  const clean =
    String(title ?? '')
      .replace(/\s+/g, ' ')
      .trim() || 'New chat';
  return clean.length > LIMITS.chatTitle ? `${clean.slice(0, LIMITS.chatTitle - 1)}…` : clean;
}

function checkInstructions(text: unknown): string {
  const clean = String(text ?? '').trim();
  if (clean.length > LIMITS.instructions) {
    throw new InputError(`Keep instructions under ${LIMITS.instructions} characters.`);
  }
  return clean;
}

/** A usable folder for a workspace (created when missing), or an InputError saying why not. */
async function checkFolder(requested: unknown): Promise<string> {
  try {
    return await prepareWorkspaceFolder(String(requested ?? ''));
  } catch (error) {
    throw new InputError(errorMessage(error));
  }
}
