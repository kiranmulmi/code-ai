// The plugin form's environment variables, typed as KEY=value lines.

export function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

/** KEY=value per line; blank lines and # comments are skipped. Throws on a line it can't read. */
export function parseEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    const key = eq === -1 ? '' : line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Line ${index + 1}: write it as NAME=value.`);
    }
    env[key] = line.slice(eq + 1).trim();
  }
  return env;
}

/** Example arguments for a tool, from its input schema: what the test form starts with. */
export function sampleArgs(schema: Record<string, unknown>): string {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const sample: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    if (Array.isArray(prop.enum) && prop.enum.length) sample[key] = prop.enum[0];
    else if (prop.default !== undefined) sample[key] = prop.default;
    else if (prop.type === 'number' || prop.type === 'integer') sample[key] = 0;
    else if (prop.type === 'boolean') sample[key] = false;
    else if (prop.type === 'array') sample[key] = [];
    else if (prop.type === 'object') sample[key] = {};
    else sample[key] = '';
  }
  return JSON.stringify(sample, null, 2);
}
