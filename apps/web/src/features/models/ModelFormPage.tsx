import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  DEFAULT_CONTEXT_WINDOW,
  LIMITS,
  MODEL_CATEGORIES,
  modelInputSchema,
  modelUpdateSchema,
  type ModelCategory,
} from '@app/shared';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { InfoTip } from '../../components/InfoTip';
import { ERROR_SM as ERROR, INPUT_ERROR, INPUT_OK } from '../../components/form';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { FormActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage } from '../../lib/api';
import { TrashIcon } from '../../lib/icons';
import { fromPath } from '../../lib/routerState';
import { useToast } from '../../lib/toast';
import { createModel, deleteModel, fetchModel, updateModel } from './api';
import { CATEGORY_INFO, parseCategory } from './categories';
import { SERVER_PRESETS } from './servers';
import { APP_NAME } from '../../lib/brand';

type Field = 'name' | 'model' | 'baseUrl' | 'apiKey' | 'maxTokens' | 'contextWindow';
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: readonly string[] = [
  'name',
  'model',
  'baseUrl',
  'apiKey',
  'maxTokens',
  'contextWindow',
];
/** Common context window sizes, offered as quick picks. */
const WINDOW_PRESETS = [32_000, 128_000, 200_000, 1_000_000] as const;
const windowLabel = (tokens: number) =>
  tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${Math.round(tokens / 1_000)}K`;
const isField = (value: unknown): value is Field =>
  typeof value === 'string' && FIELDS.includes(value);

const PRESET =
  'h-6 rounded-md border px-2 text-[11.5px] font-medium transition-colors disabled:opacity-50';

// A denser take on the shared form styles: this form opens in the settings popup.
const LABEL = 'block text-[12.5px] font-semibold text-ink';
const OPTIONAL = 'font-normal text-ink-3';
const FIELD_BOX =
  'h-8 rounded-lg border bg-surface px-2.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:ring-1 focus:ring-accent focus-visible:outline-none';
const FIELD = `${FIELD_BOX} mt-1 w-full`;

/**
 * Add or edit one model: `/settings/models/new` and `/settings/models/:modelId/edit`.
 * A saved API key is never shown again: leave the field empty to keep it.
 */
export function ModelFormPage() {
  const { modelId } = useParams();
  const isEdit = modelId !== undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const backTo = fromPath(location.state) ?? '/settings/models';
  const [searchParams] = useSearchParams();

  // A new model starts in the section its Add button was in (`?category=voice`).
  const [category, setCategory] = useState<ModelCategory>(() =>
    parseCategory(searchParams.get('category')),
  );
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [isKeyRemoved, setIsKeyRemoved] = useState(false);
  const [maxTokens, setMaxTokens] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [supportsReasoning, setSupportsReasoning] = useState(false);
  const [supportsImages, setSupportsImages] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [wasDefault, setWasDefault] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  usePageHeader({
    title: isEdit ? 'Edit model' : 'Add model',
    subtitle: `Any server that speaks the OpenAI API. ${CATEGORY_INFO[category].detail} Shared by every workspace.`,
    breadcrumbs: [
      { label: APP_NAME, to: '/' },
      { label: 'Models', to: '/settings/models' },
      { label: isEdit ? name || 'Model' : 'New model' },
    ],
  });

  useEffect(() => {
    if (!modelId) return;
    let isCurrent = true;
    setIsLoading(true);
    fetchModel(modelId)
      .then((saved) => {
        if (!isCurrent) return;
        setCategory(saved.category);
        setName(saved.name);
        setModel(saved.model);
        setBaseUrl(saved.baseUrl ?? '');
        setHasSavedKey(saved.hasApiKey);
        setMaxTokens(saved.maxTokens === null ? '' : String(saved.maxTokens));
        setContextWindow(saved.contextWindow === null ? '' : String(saved.contextWindow));
        setSupportsReasoning(saved.supportsReasoning);
        setSupportsImages(saved.supportsImages);
        setIsDefault(saved.isDefault);
        setWasDefault(saved.isDefault);
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return;
        toast(errorMessage(cause, "Couldn't load the model."), 'error');
        navigate(backTo, { replace: true });
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [modelId, backTo, navigate, toast]);

  const clearError = (field: Field) => setErrors((current) => ({ ...current, [field]: undefined }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const tokens = maxTokens.trim();
    const window = contextWindow.trim();
    const typedKey = apiKey.trim();
    const isChat = category === 'chat';
    const isVoice = category === 'voice';
    const body = {
      category,
      // A blank name takes the model's own name.
      name: name.trim() || model.trim(),
      model,
      baseUrl,
      // A voice model only lends its server (URL and key) to the voice settings.
      maxTokens: isVoice || tokens === '' ? null : Number(tokens),
      contextWindow: isVoice || window === '' ? null : Number(window),
      supportsReasoning: isChat && supportsReasoning,
      // An image model is there to read images.
      supportsImages: category === 'image' ? true : supportsImages,
      isDefault: isChat && isDefault,
    };
    // Editing: an untouched key field keeps the saved key.
    const apiKeyChange = typedKey ? typedKey : isKeyRemoved || !isEdit ? '' : undefined;
    const checked = isEdit
      ? modelUpdateSchema.safeParse({ ...body, apiKey: apiKeyChange })
      : modelInputSchema.safeParse({ ...body, apiKey: apiKeyChange ?? '' });
    if (!checked.success) {
      const found: FieldErrors = {};
      for (const issue of checked.error.issues) {
        const field = issue.path[0];
        if (isField(field)) found[field] ??= issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});

    setIsSaving(true);
    try {
      if (modelId) await updateModel(modelId, { ...body, apiKey: apiKeyChange });
      else await createModel({ ...body, apiKey: apiKeyChange ?? '' });
      toast(isEdit ? 'Model saved' : 'Model added');
      navigate(backTo);
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the model."), 'error');
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!modelId) return;
    setIsDeleting(true);
    try {
      await deleteModel(modelId);
      toast('Model deleted');
      navigate(backTo, { replace: true });
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the model."), 'error');
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };
  const cancelDelete = useCallback(() => setIsDeleteOpen(false), []);

  if (isLoading) return <PageLoader />;

  const keyPlaceholder =
    hasSavedKey && !isKeyRemoved ? 'Saved. Type a new key to replace it' : 'sk-…';

  return (
    <div className="w-full">
      <form
        id="model-form"
        noValidate
        onSubmit={(event) => void submit(event)}
        className="panel grid gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-6"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 sm:col-span-6">
          <span className="flex items-center gap-1">
            <span id="model-category" className={LABEL}>
              Category
            </span>
            <InfoTip text={CATEGORY_INFO[category].detail} />
          </span>
          <div role="radiogroup" aria-labelledby="model-category" className="flex flex-wrap gap-1">
            {MODEL_CATEGORIES.map((option) => {
              const isOn = category === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={isOn}
                  onClick={() => setCategory(option)}
                  className={`${PRESET} ${
                    isOn
                      ? 'border-accent bg-accent-soft text-accent-2'
                      : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {CATEGORY_INFO[option].label}
                </button>
              );
            })}
          </div>
          {wasDefault && category !== 'chat' && (
            <p className="w-full text-[11.5px] leading-snug text-ink-3">
              This is the default chat model. Saving it as another category makes the oldest chat
              model the default.
            </p>
          )}
        </div>

        <div className="min-w-0 sm:col-span-6">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="flex items-center gap-1">
              <label htmlFor="model-url" className={LABEL}>
                Server
              </label>
              <InfoTip text="OpenAI-compatible base URL, usually ending in /v1. Empty uses api.openai.com." />
            </span>
            <div className="flex flex-wrap gap-1">
              {SERVER_PRESETS.map((preset) => {
                const isOn = baseUrl.trim().replace(/\/+$/, '') === preset.baseUrl;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    aria-pressed={isOn}
                    onClick={() => {
                      setBaseUrl(preset.baseUrl);
                      clearError('baseUrl');
                    }}
                    className={`${PRESET} ${
                      isOn
                        ? 'border-accent bg-accent-soft text-accent-2'
                        : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
          <input
            id="model-url"
            value={baseUrl}
            autoComplete="off"
            spellCheck={false}
            maxLength={LIMITS.modelUrl}
            placeholder="https://api.openai.com/v1"
            aria-invalid={errors.baseUrl ? true : undefined}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              clearError('baseUrl');
            }}
            className={`${FIELD} ${errors.baseUrl ? INPUT_ERROR : INPUT_OK} font-mono`}
          />
          {errors.baseUrl && (
            <p role="alert" className={ERROR}>
              {errors.baseUrl}
            </p>
          )}
        </div>

        <div className="min-w-0 sm:col-span-3">
          <span className="flex items-center gap-1">
            <label htmlFor="model-id" className={LABEL}>
              Model name
            </label>
            <InfoTip text="Exactly as the server lists it." />
          </span>
          <input
            id="model-id"
            value={model}
            autoFocus={!isEdit}
            autoComplete="off"
            spellCheck={false}
            maxLength={LIMITS.modelId}
            placeholder={
              category === 'voice'
                ? 'whisper-1, gpt-4o-mini-tts, …'
                : category === 'image'
                  ? 'gpt-4.1-mini, llava, …'
                  : 'gpt-4.1, llama3.1:8b, …'
            }
            aria-invalid={errors.model ? true : undefined}
            onChange={(event) => {
              setModel(event.target.value);
              clearError('model');
            }}
            className={`${FIELD} ${errors.model ? INPUT_ERROR : INPUT_OK} font-mono`}
          />
          {errors.model && (
            <p role="alert" className={ERROR}>
              {errors.model}
            </p>
          )}
        </div>
        <div className="min-w-0 sm:col-span-3">
          <span className="flex items-center gap-1">
            <label htmlFor="model-name" className={LABEL}>
              Display name <span className={OPTIONAL}>· optional</span>
            </label>
            <InfoTip text="Shown in the model picker." />
          </span>
          <input
            id="model-name"
            value={name}
            autoComplete="off"
            maxLength={LIMITS.modelName}
            placeholder={model.trim() || 'GPT-4.1'}
            aria-invalid={errors.name ? true : undefined}
            onChange={(event) => {
              setName(event.target.value);
              clearError('name');
            }}
            className={`${FIELD} ${errors.name ? INPUT_ERROR : INPUT_OK}`}
          />
          {errors.name && (
            <p role="alert" className={ERROR}>
              {errors.name}
            </p>
          )}
        </div>

        <div className="min-w-0 sm:col-span-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1">
              <label htmlFor="model-key" className={`${LABEL} truncate`}>
                API key <span className={OPTIONAL}>· optional</span>
              </label>
              <InfoTip
                text={
                  isKeyRemoved
                    ? 'The saved key is removed when you save.'
                    : 'Not needed for Ollama or LM Studio. Kept in ~/.code-ai/models.json, readable only by you, sent only to this server, and never shown again.'
                }
              />
            </span>
            {hasSavedKey && !apiKey && (
              <button
                type="button"
                onClick={() => setIsKeyRemoved(!isKeyRemoved)}
                className={`shrink-0 text-[11px] font-medium ${
                  isKeyRemoved ? 'text-ink-2 hover:text-ink' : 'text-danger hover:underline'
                }`}
              >
                {isKeyRemoved ? 'Keep saved key' : 'Remove saved key'}
              </button>
            )}
          </div>
          <input
            id="model-key"
            type="password"
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            maxLength={LIMITS.apiKey}
            placeholder={keyPlaceholder}
            aria-invalid={errors.apiKey ? true : undefined}
            onChange={(event) => {
              setApiKey(event.target.value);
              clearError('apiKey');
            }}
            className={`${FIELD} ${errors.apiKey ? INPUT_ERROR : INPUT_OK} font-mono`}
          />
          {errors.apiKey && (
            <p role="alert" className={ERROR}>
              {errors.apiKey}
            </p>
          )}
        </div>
        {category !== 'voice' && (
          <div className="min-w-0 sm:col-span-3">
            <span className="flex items-center gap-1">
              <label htmlFor="model-max-tokens" className={LABEL}>
                Max output tokens <span className={OPTIONAL}>· optional</span>
              </label>
              <InfoTip text="Empty uses the server's default." />
            </span>
            <input
              id="model-max-tokens"
              inputMode="numeric"
              value={maxTokens}
              autoComplete="off"
              placeholder="Server default"
              aria-invalid={errors.maxTokens ? true : undefined}
              onChange={(event) => {
                setMaxTokens(event.target.value.replace(/[^\d]/g, ''));
                clearError('maxTokens');
              }}
              className={`${FIELD} ${errors.maxTokens ? INPUT_ERROR : INPUT_OK} tabular-nums`}
            />
            {errors.maxTokens && (
              <p role="alert" className={ERROR}>
                {errors.maxTokens}
              </p>
            )}
          </div>
        )}

        {category !== 'voice' && (
          <div className="min-w-0 sm:col-span-6">
            <span className="flex items-center gap-1">
              <label htmlFor="model-context-window" className={LABEL}>
                Context window <span className={OPTIONAL}>· tokens, optional</span>
              </label>
              <InfoTip
                text={`Input and output together; long chats are summarized near it. Empty assumes ${windowLabel(DEFAULT_CONTEXT_WINDOW)}.`}
              />
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <input
                id="model-context-window"
                inputMode="numeric"
                value={contextWindow}
                autoComplete="off"
                placeholder={`${DEFAULT_CONTEXT_WINDOW.toLocaleString('en')} (default)`}
                aria-invalid={errors.contextWindow ? true : undefined}
                onChange={(event) => {
                  setContextWindow(event.target.value.replace(/[^\d]/g, ''));
                  clearError('contextWindow');
                }}
                className={`${FIELD_BOX} ${errors.contextWindow ? INPUT_ERROR : INPUT_OK} min-w-0 flex-1 basis-[16ch] tabular-nums`}
              />
              {WINDOW_PRESETS.map((preset) => {
                const isOn = contextWindow === String(preset);
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setContextWindow(String(preset));
                      clearError('contextWindow');
                    }}
                    aria-pressed={isOn}
                    className={`${PRESET} tabular-nums ${
                      isOn
                        ? 'border-accent bg-accent-soft text-accent-2'
                        : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    {windowLabel(preset)}
                  </button>
                );
              })}
            </div>
            {errors.contextWindow && (
              <p role="alert" className={ERROR}>
                {errors.contextWindow}
              </p>
            )}
          </div>
        )}

        {category === 'chat' && (
          <div className="grid gap-x-3 gap-y-1 border-t border-line-2 pt-2 sm:col-span-6 sm:grid-cols-3">
            <ToggleRow
              label="Reasoning effort"
              hint="Offers Low, Medium or High per message (o-series, GPT-5, DeepSeek R1, …)."
            >
              <Switch
                isOn={supportsReasoning}
                onChange={setSupportsReasoning}
                label="Supports reasoning effort"
              />
            </ToggleRow>
            <ToggleRow
              label="Reads images"
              hint="Turn off for text-only models: images then go to the image model set in Settings → Agent, which describes them in text."
            >
              <Switch isOn={supportsImages} onChange={setSupportsImages} label="Reads images" />
            </ToggleRow>
            <ToggleRow
              label="Default model"
              align="end"
              hint={
                wasDefault
                  ? 'This is the default. Make another model the default to change it.'
                  : 'Used when no model is picked, and by the terminal chat.'
              }
            >
              <Switch
                isOn={isDefault}
                onChange={setIsDefault}
                disabled={wasDefault}
                label="Default model"
              />
            </ToggleRow>
          </div>
        )}
      </form>

      <FormActions>
        {isEdit && (
          <Button
            variant="danger-ghost"
            className="mr-auto"
            onClick={() => setIsDeleteOpen(true)}
            disabled={isSaving}
          >
            <TrashIcon /> Delete
          </Button>
        )}
        <Button onClick={() => navigate(backTo)}>Cancel</Button>
        <Button variant="primary" type="submit" form="model-form" disabled={isSaving}>
          {isSaving && <Spinner size={13} />}
          {isSaving ? 'Saving…' : isEdit ? 'Save' : 'Add model'}
        </Button>
      </FormActions>

      {isEdit && (
        <ConfirmDeleteDialog
          open={isDeleteOpen}
          title="Delete this model?"
          message={
            <>
              <strong className="text-ink">{name || model}</strong> and its saved API key are
              removed. Chats keep their history.
              {wasDefault && ' The oldest remaining chat model becomes the default.'}
            </>
          }
          busy={isDeleting}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}

/** A label with its info tip, and an on/off switch beside it on the same line. */
function ToggleRow({
  label,
  hint,
  align,
  children,
}: {
  label: string;
  hint: string;
  /** where the info tip opens; `end` for the right-most toggle */
  align?: 'start' | 'end';
  children: ReactNode;
}) {
  return (
    <div className="flex h-7 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1">
        <span className={`${LABEL} truncate`}>{label}</span>
        <InfoTip text={hint} align={align} />
      </span>
      {children}
    </div>
  );
}
