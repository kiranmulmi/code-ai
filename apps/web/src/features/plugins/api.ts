import type {
  Plugin,
  PluginInput,
  PluginSummary,
  PluginTestRequest,
  PluginTestResult,
  PluginWriteRequest,
  WrittenPlugin,
} from '@app/shared';
import { jsonBody, request } from '../../lib/api';

const pluginPath = (name: string) => `/plugins/${encodeURIComponent(name)}`;

export const fetchPlugins = () => request<PluginSummary[]>('/plugins');

export const fetchPlugin = (name: string) => request<Plugin>(pluginPath(name));

export const createPlugin = (input: PluginInput) =>
  request<Plugin>('/plugins', jsonBody('POST', input));

/** Saves `name` as `input`; a different `input.name` renames it. */
export const updatePlugin = (name: string, input: PluginInput) =>
  request<Plugin>(pluginPath(name), jsonBody('PUT', input));

export const deletePlugin = (name: string) => request<void>(pluginPath(name), { method: 'DELETE' });

/** Runs draft code once in its own process: its tools and, with `tool`, one call's result. */
export const testPlugin = (input: PluginTestRequest) =>
  request<PluginTestResult>('/plugins/test', jsonBody('POST', input));

/** The AI writer: code from a request, a change to it, or a fix for a test's error. */
export const writePluginCode = (input: PluginWriteRequest) =>
  request<WrittenPlugin>('/plugins/write', jsonBody('POST', input));
