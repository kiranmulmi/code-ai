import { createModelCaller, testPluginCode, writePlugin } from '@app/agent';
import { InputError, PluginExistsError } from '@app/db';
import type {
  Plugin,
  PluginInput,
  PluginSummary,
  PluginTestRequest,
  PluginTestResult,
  PluginWriteRequest,
  WrittenPlugin,
} from '@app/shared';
import { pluginInputSchema } from '@app/shared';
import type { AppContext } from '../../context.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import type { ModelsService } from '../models/models.service.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/**
 * Tool plugins (the Tools tab): the AI writes their code, a test runs it in its own process,
 * and saving makes it an MCP server each workspace can turn on.
 */
export function createPluginsService(
  { store, mcp: hub, runs }: AppContext,
  workspaces: WorkspacesService,
  models: ModelsService,
) {
  /** A plugin's code changed: its running servers stop, and start again with the new code. */
  async function restartEverywhere(name: string): Promise<void> {
    for (const workspace of await store.listWorkspaces()) await hub.restart(workspace.id, name);
  }

  function requireAllIdle(): void {
    if (runs.hasAny()) {
      throw new ConflictError("A chat is still running. Change tool plugins when it's done.");
    }
  }

  async function save(current: string | null, body: PluginInput): Promise<Plugin> {
    requireAllIdle();
    const input = pluginInputSchema.parse(body);
    try {
      const saved = await store.plugins.save(current, input);
      if (current) await restartEverywhere(current);
      if (current !== input.name) {
        await restartEverywhere(input.name);
        if (current) await store.renameMcpServer(current, input.name);
      }
      return saved;
    } catch (error) {
      if (error instanceof PluginExistsError) throw new ConflictError(error.message);
      if (error instanceof InputError) throw new ValidationError(error.message);
      throw error;
    }
  }

  return {
    list: (): Promise<PluginSummary[]> => store.plugins.list(),

    async get(name: string): Promise<Plugin> {
      const plugin = await store.plugins.get(name).catch(() => null);
      if (!plugin) throw new NotFoundError(`There is no plugin named "${name}".`);
      return plugin;
    },

    create: (input: PluginInput) => save(null, input),

    update: (name: string, input: PluginInput) => save(name, input),

    async remove(name: string): Promise<void> {
      requireAllIdle();
      await restartEverywhere(name);
      if (!(await store.plugins.remove(name).catch(() => false))) {
        throw new NotFoundError(`There is no plugin named "${name}".`);
      }
    },

    /** Runs draft code once: lists its tools and, with `tool`, calls it. Nothing is saved. */
    async test(input: PluginTestRequest & { code: string }): Promise<PluginTestResult> {
      const workspace = input.workspaceId ? await workspaces.require(input.workspaceId) : null;
      return testPluginCode({
        code: input.code,
        env: input.env ?? {},
        tool: input.tool,
        args: input.args ?? {},
        cwd: workspace?.path,
      });
    },

    /** The AI writer: new code from a request, a change, or a fix for a test's error. */
    async write(input: PluginWriteRequest): Promise<WrittenPlugin> {
      const { settings } = await models.forRun(input.modelId, undefined);
      const written = await writePlugin(createModelCaller(settings), {
        request: input.request,
        name: input.name,
        description: input.description,
        code: input.code ?? '',
        error: input.error,
        envNames: input.envNames,
      });
      if (!written) throw new ValidationError("The model didn't return any code. Try again.");
      return written;
    },
  };
}

export type PluginsService = ReturnType<typeof createPluginsService>;
