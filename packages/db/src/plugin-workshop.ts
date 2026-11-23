// Tool plugins built from the chat (list_tool_plugins, test_tool_plugin, save_tool_plugin in
// @app/agent): the same plugins the Tools tab makes, kept by PluginStore. A test runs the
// draft in the workspace folder; saving restarts the plugin's running servers and turns it
// on in the workspace the chat is in.
import {
  testPluginCode,
  type McpHub,
  type PluginSaveInput,
  type PluginTestInput,
  type PluginWorkshop,
} from '@app/agent';
import { pluginInputSchema, type Workspace } from '@app/shared';
import { InputError } from './errors.js';
import type { Store } from './store.js';

export function pluginWorkshop(
  store: Store,
  workspace: Pick<Workspace, 'id' | 'path' | 'name'>,
  hub?: McpHub,
): PluginWorkshop {
  const savedEnv = async (name: string | undefined): Promise<Record<string, string>> => {
    if (!name) return {};
    const plugin = await store.plugins.get(name);
    if (!plugin) throw new InputError(`There is no plugin named "${name}".`);
    return plugin.env;
  };

  return {
    list: () => store.plugins.list(),

    async get(name) {
      const plugin = await store.plugins.get(name).catch(() => null);
      if (!plugin) return null;
      return {
        name: plugin.name,
        description: plugin.description,
        code: plugin.code,
        envNames: Object.keys(plugin.env),
      };
    },

    async test({ code, envFrom, env = {}, tool, args = {} }: PluginTestInput) {
      return testPluginCode({
        code,
        env: { ...(await savedEnv(envFrom)), ...env },
        tool,
        args,
        cwd: workspace.path,
      });
    },

    async save({ name, description, code, env = {}, replace }: PluginSaveInput) {
      const before = await store.plugins.get(name).catch(() => null);
      if (before && !replace) {
        throw new InputError(
          `There is already a plugin named "${name}". Pass replace: true to overwrite it, or pick another name.`,
        );
      }
      const parsed = pluginInputSchema.safeParse({
        name,
        description,
        code,
        env: { ...(before?.env ?? {}), ...env },
      });
      if (!parsed.success) {
        throw new InputError(parsed.error.issues.map((issue) => issue.message).join(' '));
      }
      // Load it once more as saved, so a broken plugin is never turned on.
      const check = await testPluginCode({
        code: parsed.data.code,
        env: parsed.data.env,
        cwd: workspace.path,
      });
      if (check.error) throw new InputError(`The code doesn't load: ${check.error}`);

      const saved = await store.plugins.save(before ? name : null, parsed.data);
      if (hub) {
        // Servers running the old code stop; they start again with the new code when needed.
        for (const each of await store.listWorkspaces()) await hub.restart(each.id, name);
      }
      const state = await store.mcp(workspace).setEnabled(saved.name, true);
      return {
        name: saved.name,
        isNew: !before,
        tools: check.tools.map((t) => t.name),
        isOn: state.enabled.includes(saved.name),
        isTrusted: state.isTrusted,
      };
    },
  };
}
