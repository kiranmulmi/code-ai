import type { ModelCategory, ModelProfile } from '@app/shared';
import { splitModels } from './categories';

/**
 * `<option>`s for a `<select>` of models for one use: only that category's models. The one
 * already picked (`selectedId`) stays listed even from another category, so opening a
 * setting never silently changes it.
 */
export function ModelOptions({
  models,
  category,
  selectedId,
  describe = (model) => model.name,
}: {
  models: readonly ModelProfile[] | null | undefined;
  category: ModelCategory;
  selectedId?: string | null;
  describe?: (model: ModelProfile) => string;
}) {
  const { matching, others } = splitModels(models, category);
  const current = others.find((model) => model.id === selectedId);
  return (
    <>
      {matching.map((model) => (
        <option key={model.id} value={model.id}>
          {describe(model)}
        </option>
      ))}
      {current && (
        <option value={current.id}>
          {describe(current)} ({current.category} model)
        </option>
      )}
    </>
  );
}
