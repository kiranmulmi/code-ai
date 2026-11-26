import { MODEL_CATEGORIES, type ModelCategory, type ModelProfile } from '@app/shared';

/** How each model category is named and explained in the UI. */
export const CATEGORY_INFO: Record<
  ModelCategory,
  { title: string; label: string; detail: string; empty: string }
> = {
  chat: {
    title: 'Chat models',
    label: 'Chat',
    detail: 'Run the agent. Pick one per message in the chat; must support tool calling.',
    empty: 'No chat models yet. Add one to start chatting.',
  },
  voice: {
    title: 'Voice models',
    label: 'Voice',
    detail:
      'Servers for speech to text and spoken replies (/audio/transcriptions, /audio/speech). Pick one in Workspace settings → Voice.',
    empty: 'No voice models yet.',
  },
  image: {
    title: 'Image models',
    label: 'Image',
    detail:
      'Look at images for chat models that can’t read them. Pick one in Settings → Agent → Image model.',
    empty: 'No image models yet.',
  },
};

/** A category from a query string value; anything else is `chat`. */
export function parseCategory(value: string | null): ModelCategory {
  return MODEL_CATEGORIES.find((category) => category === value) ?? 'chat';
}

/**
 * Every model, for a picker of one use: the models of that category first (`matching`), then
 * the rest (`others`). The category is only a suggestion; any model can be picked for any use.
 */
export function splitModels<T extends ModelProfile>(
  models: readonly T[] | null | undefined,
  category: ModelCategory,
): { matching: T[]; others: T[] } {
  const list = models ?? [];
  return {
    matching: list.filter((model) => model.category === category),
    others: list.filter((model) => model.category !== category),
  };
}

/** `splitModels` as one list, the category's own first. */
export function modelsFor<T extends ModelProfile>(
  models: readonly T[] | null | undefined,
  category: ModelCategory,
): T[] {
  const { matching, others } = splitModels(models, category);
  return [...matching, ...others];
}
