// The models the agent can run on, app-wide, in ~/.code-ai/models.json (written 0600).
// API keys are kept there and only ever leave through `settingsFor`, for a run on this
// machine; the UI sees `hasApiKey`.
import { randomUUID } from 'node:crypto';
import { serialized, type ModelSettings } from '@app/agent';
import {
  MODEL_CATEGORIES,
  MODEL_PROVIDERS,
  modelInputSchema,
  modelUpdateSchema,
  type ModelInput,
  type ModelProfile,
  type ModelUpdate,
} from '@app/shared';
import { z } from 'zod';
import { InputError } from './errors.js';
import { readJson, writePrivateJson } from './json-file.js';
import { isUuid } from './workspace-data.js';

/** One model as saved, in creation order. Fields a hand edit leaves out get their defaults. */
const savedModelSchema = z.object({
  id: z.string().refine(isUuid, 'must be a UUID'),
  name: z.string().min(1),
  model: z.string().min(1),
  provider: z.enum(MODEL_PROVIDERS).default('openai'),
  category: z.enum(MODEL_CATEGORIES).default('chat'),
  baseUrl: z.string().nullable().default(null),
  apiKey: z.string().nullable().default(null),
  maxTokens: z.number().int().positive().nullable().default(null),
  contextWindow: z.number().int().positive().nullable().default(null),
  supportsReasoning: z.boolean().default(false),
  supportsImages: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  createdAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});

type SavedModel = z.output<typeof savedModelSchema>;

/**
 * Providers the app once offered and no longer does. Models saved with one are skipped when
 * the file is read (and dropped from it on the next change), so they don't break the list.
 */
const REMOVED_PROVIDERS: readonly string[] = ['cursor'];

const isRemovedProviderModel = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  'provider' in value &&
  typeof value.provider === 'string' &&
  REMOVED_PROVIDERS.includes(value.provider);

const modelsFileSchema = z.object({
  models: z.preprocess(
    (value) => (Array.isArray(value) ? value.filter((m) => !isRemovedProviderModel(m)) : value),
    z.array(savedModelSchema).default([]),
  ),
});

/** A model ready for a run: what the UI shows, and what the agent needs to call it. */
export interface ResolvedModel {
  profile: ModelProfile;
  /** `reasoningEffort` is null here; the run sets it from the request. */
  settings: ModelSettings;
}

export class ModelStore {
  constructor(readonly file: string) {}

  /** Oldest first, so the list stays put as models are added. */
  async list(): Promise<ModelProfile[]> {
    return (await this.#read()).map(toProfile);
  }

  async get(id: string): Promise<ModelProfile | null> {
    const saved = (await this.#read()).find((m) => m.id === id);
    return saved ? toProfile(saved) : null;
  }

  /**
   * The first chat model becomes the default, whatever the input says. Voice and image
   * models are never the default.
   */
  async create(input: ModelInput): Promise<ModelProfile> {
    const clean = check(modelInputSchema, input);
    return this.#change((models) => {
      const now = new Date().toISOString();
      const isChat = clean.category === 'chat';
      const created: SavedModel = {
        id: randomUUID(),
        name: clean.name,
        model: clean.model,
        provider: clean.provider,
        category: clean.category,
        baseUrl: clean.baseUrl,
        apiKey: clean.apiKey || null,
        maxTokens: clean.maxTokens,
        contextWindow: clean.contextWindow,
        supportsReasoning: clean.supportsReasoning,
        supportsImages: clean.supportsImages,
        isDefault: isChat && (clean.isDefault || !models.some((m) => m.category === 'chat')),
        createdAt: now,
        updatedAt: now,
      };
      const others = created.isDefault ? models.map(notDefault) : models;
      return { models: [...others, created], result: toProfile(created) };
    });
  }

  /**
   * Replaces the model's settings. A left-out `apiKey` keeps the saved key. The default
   * stays the default until another chat model takes over, so there is always one; a default
   * moved to another category hands it to the oldest chat model left (see `#read`).
   */
  async update(id: string, changes: ModelUpdate): Promise<ModelProfile | null> {
    const clean = check(modelUpdateSchema, changes);
    return this.#change((models) => {
      const current = models.find((m) => m.id === id);
      if (!current) return { models, result: null };
      const category = clean.category ?? current.category;
      const isChat = category === 'chat';
      const updated: SavedModel = {
        ...current,
        name: clean.name,
        model: clean.model,
        provider: clean.provider ?? current.provider,
        category,
        baseUrl: clean.baseUrl,
        apiKey: clean.apiKey === undefined ? current.apiKey : clean.apiKey || null,
        maxTokens: clean.maxTokens,
        contextWindow: clean.contextWindow,
        supportsReasoning: clean.supportsReasoning,
        supportsImages: clean.supportsImages,
        isDefault: isChat && (clean.isDefault || current.isDefault),
        updatedAt: new Date().toISOString(),
      };
      const next = models.map((m) =>
        m.id === id ? updated : updated.isDefault ? notDefault(m) : m,
      );
      // Read back with the default settled, as the next `list` will show it.
      const settled = withOneDefault(next).find((m) => m.id === id) ?? updated;
      return { models: next, result: toProfile(settled) };
    });
  }

  /** Only a chat model can be the default. */
  async setDefault(id: string): Promise<ModelProfile | null> {
    return this.#change((models) => {
      const current = models.find((m) => m.id === id);
      if (!current) return { models, result: null };
      if (current.category !== 'chat') {
        throw new InputError('Only a chat model can be the default.');
      }
      const updated = { ...current, isDefault: true, updatedAt: new Date().toISOString() };
      return {
        models: models.map((m) => (m.id === id ? updated : notDefault(m))),
        result: toProfile(updated),
      };
    });
  }

  /** Deleting the default hands it to the oldest chat model left (see `#read`). */
  async remove(id: string): Promise<boolean> {
    return this.#change((models) => {
      const left = models.filter((m) => m.id !== id);
      const isRemoved = left.length < models.length;
      return { models: isRemoved ? left : models, result: isRemoved };
    });
  }

  /**
   * A model by its name or model name, ignoring case (for the CLI's /model command). Chat
   * models win a tie, but any model can be picked.
   */
  async findByName(name: string): Promise<ModelProfile | null> {
    const wanted = name.trim().toLowerCase();
    const all = await this.#read();
    const models = [
      ...all.filter((m) => m.category === 'chat'),
      ...all.filter((m) => m.category !== 'chat'),
    ];
    const found =
      models.find((m) => m.name.toLowerCase() === wanted) ??
      models.find((m) => m.model.toLowerCase() === wanted);
    return found ? toProfile(found) : null;
  }

  /**
   * The model a run uses: the one asked for, or the default when `id` is left out.
   * Null when that model doesn't exist, or no model is set up yet.
   */
  async settingsFor(id?: string): Promise<ResolvedModel | null> {
    const models = await this.#read();
    const saved =
      id === undefined ? models.find((m) => m.isDefault) : models.find((m) => m.id === id);
    if (!saved) return null;
    return {
      profile: toProfile(saved),
      settings: {
        label: saved.name,
        provider: saved.provider,
        model: saved.model,
        baseURL: saved.baseUrl ?? undefined,
        apiKey: saved.apiKey ?? '',
        maxTokens: saved.maxTokens,
        contextWindow: saved.contextWindow,
        reasoningEffort: null,
        supportsReasoning: saved.supportsReasoning,
        supportsImages: saved.supportsImages,
      },
    };
  }

  /**
   * The models a run's helpers use, from Settings → Agent: sub-agents, the reviewer and the
   * image model. One that isn't set, or was deleted since, is left out: sub-agents and the
   * reviewer then use the run's own model, and a model that can't read images gets none.
   */
  async helpersFor({
    subagentModelId,
    reviewModelId,
    visionModelId = null,
  }: {
    subagentModelId: string | null;
    reviewModelId: string | null;
    visionModelId?: string | null;
  }): Promise<{
    subagentModel?: ModelSettings;
    reviewModel?: ModelSettings;
    visionModel?: ModelSettings;
  }> {
    const settingsOf = async (id: string | null) =>
      id ? ((await this.settingsFor(id))?.settings ?? undefined) : undefined;
    const [subagentModel, reviewModel, visionModel] = await Promise.all([
      settingsOf(subagentModelId),
      settingsOf(reviewModelId),
      settingsOf(visionModelId),
    ]);
    return {
      ...(subagentModel ? { subagentModel } : {}),
      ...(reviewModel ? { reviewModel } : {}),
      ...(visionModel ? { visionModel } : {}),
    };
  }

  /** The saved models, with exactly one default whenever there are chat models. */
  async #read(): Promise<SavedModel[]> {
    const raw = await readJson(this.file);
    if (raw === null) return [];
    const parsed = modelsFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `${this.file} is damaged: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
      );
    }
    return withOneDefault(parsed.data.models);
  }

  /** Read, change and write the file as one step, so concurrent changes can't lose each other. */
  #change<T>(update: (models: SavedModel[]) => { models: SavedModel[]; result: T }): Promise<T> {
    return serialized(this.file, async () => {
      const before = await this.#read();
      const { models, result } = update(before);
      if (models !== before) await writePrivateJson(this.file, { models });
      return result;
    });
  }
}

function check<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InputError(result.error.issues[0]?.message ?? 'Check the model settings.');
  }
  return result.data;
}

const notDefault = (model: SavedModel): SavedModel =>
  model.isDefault ? { ...model, isDefault: false } : model;

/**
 * Exactly one chat model is the default (the first marked one, else the oldest); voice and
 * image models never are. No chat models: no default.
 */
function withOneDefault(models: SavedModel[]): SavedModel[] {
  const marked = models.findIndex((m) => m.isDefault && m.category === 'chat');
  const defaultIndex = marked >= 0 ? marked : models.findIndex((m) => m.category === 'chat');
  return models.map((m, index) => ({ ...m, isDefault: index === defaultIndex }));
}

function toProfile(saved: SavedModel): ModelProfile {
  return {
    id: saved.id,
    name: saved.name,
    model: saved.model,
    provider: saved.provider,
    category: saved.category,
    baseUrl: saved.baseUrl,
    hasApiKey: Boolean(saved.apiKey),
    maxTokens: saved.maxTokens,
    contextWindow: saved.contextWindow,
    supportsReasoning: saved.supportsReasoning,
    supportsImages: saved.supportsImages,
    isDefault: saved.isDefault,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  };
}
