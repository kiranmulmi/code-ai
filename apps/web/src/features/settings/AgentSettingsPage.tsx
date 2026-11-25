import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  APPROVAL_MODES,
  DEFAULT_AGENT_SETTINGS,
  LOG_LEVELS,
  REVIEW_MODES,
  SETTINGS_LIMITS,
  agentSettingsSchema,
  type AgentSettings,
  type ApprovalMode,
  type LogLevel,
  type ModelProfile,
  type ReviewMode,
} from '@app/shared';
import { Button } from '../../components/Button';
import { ERROR_SM as ERROR, INPUT_ERROR, INPUT_OK } from '../../components/form';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { FormActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage } from '../../lib/api';
import { compactNumber } from '../../lib/format';
import { fromPath } from '../../lib/routerState';
import { useToast } from '../../lib/toast';
import { useModels } from '../models/useModels';
import { fetchSettings, saveSettings } from './api';
import { SettingsTabs } from './SettingsTabs';
import { APP_NAME } from '../../lib/brand';
import { InfoTip } from '../../components/InfoTip';

/** The form keeps numbers as typed text, so a half-typed value isn't snapped to a number. */
type NumberKey = 'maxSteps' | 'maxTotalTokens' | 'maxInputChars' | 'maxParallelSubagents';
type Draft = Omit<AgentSettings, NumberKey> & Record<NumberKey, string>;
type Field = keyof AgentSettings;
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: readonly string[] = Object.keys(DEFAULT_AGENT_SETTINGS);
const isField = (value: unknown): value is Field =>
  typeof value === 'string' && FIELDS.includes(value);

const toDraft = (settings: AgentSettings): Draft => ({
  ...settings,
  maxSteps: String(settings.maxSteps),
  maxTotalTokens: String(settings.maxTotalTokens),
  maxInputChars: String(settings.maxInputChars),
  maxParallelSubagents: String(settings.maxParallelSubagents),
});

const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));

const fromDraft = (draft: Draft) => ({
  ...draft,
  maxSteps: toNumber(draft.maxSteps),
  maxTotalTokens: toNumber(draft.maxTotalTokens),
  maxInputChars: toNumber(draft.maxInputChars),
  maxParallelSubagents: toNumber(draft.maxParallelSubagents),
});

const APPROVALS: Record<ApprovalMode, { title: string; detail: string }> = {
  ask: {
    title: 'Ask first',
    detail: 'Asks before each tool that changes something: writing files, running commands, …',
  },
  auto: {
    title: 'Run without asking',
    detail: 'Tools that change things run straight away, commands included.',
  },
  deny: {
    title: 'Refuse',
    detail: 'Tools that change things are refused. The agent can still read and search.',
  },
};

const REVIEWS: Record<ReviewMode, { title: string; detail: string }> = {
  off: { title: 'Off', detail: 'Answers go straight to you.' },
  tasks: {
    title: 'After tasks',
    detail: 'A reviewer checks answers the agent used tools for, and can send them back once.',
  },
  always: { title: 'Every answer', detail: 'A reviewer checks every answer, chat included.' },
};

const LOG_TEXT: Record<LogLevel, string> = {
  debug: 'Every event',
  info: 'Steps and problems',
  silent: 'Nothing',
};

const fmt = (value: number) => value.toLocaleString('en');

/**
 * `/settings/agent`: how the agent behaves in every workspace (approvals, planning,
 * limits, web search, logging). Saved in ~/.code-ai; applies from the next message.
 */
export function AgentSettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const backTo = fromPath(location.state) ?? '/';

  const [saved, setSaved] = useState<AgentSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isSaving, setIsSaving] = useState(false);
  const models = useModels();

  usePageHeader({
    title: 'Settings',
    subtitle: 'How the agent behaves in every workspace. Changes apply from the next message.',
    breadcrumbs: [{ label: APP_NAME, to: backTo }, { label: 'Settings' }],
  });

  useEffect(() => {
    let isCurrent = true;
    fetchSettings()
      .then((settings) => {
        if (!isCurrent) return;
        setSaved(settings);
        setDraft(toDraft(settings));
      })
      .catch((cause: unknown) => {
        if (isCurrent) setLoadError(cause);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  if (!draft || !saved) {
    return (
      <div className="w-full">
        <SettingsTabs />
        {loadError ? (
          <p
            role="alert"
            className="border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-4 py-3 text-[13px] text-danger"
          >
            {errorMessage(loadError, "Couldn't load the settings.")}
          </p>
        ) : (
          <PageLoader />
        )}
      </div>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft({ ...draft, [key]: value });
    if (isField(key)) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const isDirty = JSON.stringify(toDraft(saved)) !== JSON.stringify(draft);
  const isDefault = JSON.stringify(toDraft(DEFAULT_AGENT_SETTINGS)) === JSON.stringify(draft);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const checked = agentSettingsSchema.safeParse(fromDraft(draft));
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
      const next = await saveSettings(checked.data);
      setSaved(next);
      setDraft(toDraft(next));
      toast('Settings saved');
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the settings."), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const numberField = (
    key: NumberKey,
    label: string,
    unit: string,
    hint: string,
    isCompact = false,
  ) => {
    const { min, max } = SETTINGS_LIMITS[key];
    const id = `setting-${key}`;
    const show = isCompact ? compactNumber : fmt;
    const typed = toNumber(draft[key]);
    return (
      <Row
        label={label}
        htmlFor={id}
        hint={`${hint} ${show(min)}–${show(max)}, default ${show(DEFAULT_AGENT_SETTINGS[key])}.`}
        error={errors[key]}
      >
        {isCompact && Number.isFinite(typed) && (
          <span aria-live="polite" className="text-[11px] font-medium text-ink-3 tabular-nums">
            = {compactNumber(typed)}
          </span>
        )}
        <div className="relative">
          <input
            id={id}
            inputMode="numeric"
            autoComplete="off"
            value={draft[key]}
            aria-invalid={errors[key] ? true : undefined}
            onChange={(event) => set(key, event.target.value.replace(/[^\d]/g, ''))}
            className={`${CONTROL} ${errors[key] ? INPUT_ERROR : INPUT_OK} w-36 pr-12 text-right tabular-nums`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10.5px] text-ink-3">
            {unit}
          </span>
        </div>
      </Row>
    );
  };

  return (
    <div className="w-full">
      <SettingsTabs />

      <form
        id="settings-form"
        noValidate
        onSubmit={(event) => void submit(event)}
        className="grid items-start gap-2.5 lg:grid-cols-2"
      >
        <Card
          title="Approvals and limits"
          hint="Tools that change things outside the agent, and guardrails for each message. File tools always stay inside the workspace folder."
        >
          <Row
            label="Tool approvals"
            hint={APPROVAL_MODES.map((m) => `${APPROVALS[m].title}: ${APPROVALS[m].detail}`).join(
              ' ',
            )}
          >
            <Segmented
              label="Tool approvals"
              value={draft.approval}
              options={APPROVAL_MODES.map((m) => ({ value: m, ...APPROVALS[m] }))}
              onChange={(mode) => set('approval', mode)}
            />
          </Row>
          {draft.approval === 'auto' && (
            <p className="border-l-[3px] border-l-warn-line bg-warn-bg px-3 py-1 text-[11px] leading-snug text-warn">
              Writes files and runs commands without asking. A few catastrophic commands are still
              refused, but commands run with your user&apos;s permissions.
            </p>
          )}
          <Row
            label="Planning step"
            hint="Off (the default): the agent answers simple messages directly and makes a plan itself when a task has several steps. On: an extra model call before every message decides whether to plan first; steadier with smaller models, but slower."
          >
            <Switch
              isOn={draft.planning === 'auto'}
              onChange={(isOn) => set('planning', isOn ? 'auto' : 'off')}
              label="Planning step before every message"
            />
          </Row>
          {numberField(
            'maxSteps',
            'Max steps',
            'steps',
            "Working steps per message (planning and summaries don't count). Research with a plan can take 20+.",
          )}
          {numberField(
            'maxTotalTokens',
            'Token budget',
            'tokens',
            'Input + output tokens per message. Input the server read from its cache counts at a tenth.',
            true,
          )}
          {numberField(
            'maxInputChars',
            'Longest message',
            'chars',
            'Longer messages are rejected.',
          )}
        </Card>

        <Card
          title="Sub-agents and review"
          hint="Extra model calls that can make long tasks better, at more tokens and time."
        >
          <Row
            label="Sub-agents"
            hint="Lets the agent hand self-contained parts of a task to specialist sub-agents (delegate_task): a researcher, coder, reviewer, writer, or your own from the workspace's .code-ai/<workspace>/agents/ folder. Each works in a fresh context, shares findings on the team notes, and reports back. They share the message's token budget and ask for approval like the agent does."
          >
            <Switch
              isOn={draft.subagents}
              onChange={(isOn) => set('subagents', isOn)}
              label="Sub-agents"
            />
          </Row>
          {draft.subagents && (
            <ModelPicker
              id="setting-subagent-model"
              label="Sub-agent model"
              hint="A cheaper or faster model often does well on delegated parts."
              value={draft.subagentModelId}
              models={models.data}
              error={errors.subagentModelId}
              onChange={(id) => set('subagentModelId', id)}
            />
          )}
          {draft.subagents &&
            numberField(
              'maxParallelSubagents',
              'Parallel sub-agents',
              'at once',
              'Sub-agents that may work at the same time; more started in one step wait their turn. Higher is faster but uses tokens quicker.',
            )}
          <Row
            label="Review answers"
            hint={`${REVIEW_MODES.map((m) => `${REVIEWS[m].title}: ${REVIEWS[m].detail}`).join(' ')} The reviewer sees the request, the plan, what the tools found and the answer, but not the rest of the chat.`}
          >
            <Segmented
              label="Review answers"
              value={draft.review}
              options={REVIEW_MODES.map((m) => ({ value: m, ...REVIEWS[m] }))}
              onChange={(mode) => set('review', mode)}
            />
          </Row>
          {draft.review !== 'off' && (
            <ModelPicker
              id="setting-review-model"
              label="Reviewer model"
              hint="A different model from the agent's catches more of its blind spots."
              value={draft.reviewModelId}
              models={models.data}
              error={errors.reviewModelId}
              onChange={(id) => set('reviewModelId', id)}
            />
          )}
        </Card>

        <Card
          title="Images, web search and logging"
          hint="Still in .env, because the server needs them when it starts: PORT, CORS_ORIGIN, LOG_LEVEL (HTTP logs) and AGENT_LOG_DIR."
        >
          <ModelPicker
            id="setting-vision-model"
            label="Image model"
            hint="For chat models that can't read images (Reads images turned off in Models): this model looks at images (view_image) and describes them in text. Without one, such a model can't see images at all."
            emptyLabel="None"
            value={draft.visionModelId}
            models={models.data?.filter((m) => m.supportsImages) ?? null}
            error={errors.visionModelId}
            onChange={(id) => set('visionModelId', id)}
          />
          <Row
            label="SearXNG URL"
            htmlFor="setting-searxng"
            hint="The instance the web_search tool uses, with the JSON format turned on (search.formats: [html, json])."
            error={errors.searxngUrl}
          >
            <input
              id="setting-searxng"
              value={draft.searxngUrl}
              autoComplete="off"
              spellCheck={false}
              maxLength={SETTINGS_LIMITS.searxngUrl}
              placeholder={DEFAULT_AGENT_SETTINGS.searxngUrl}
              aria-invalid={errors.searxngUrl ? true : undefined}
              onChange={(event) => set('searxngUrl', event.target.value)}
              className={`${CONTROL} ${errors.searxngUrl ? INPUT_ERROR : INPUT_OK} w-56 font-mono text-[11.5px]`}
            />
          </Row>
          <Row
            label="Console log level"
            hint={`${LOG_TEXT[draft.logLevel]} in the server's terminal. Each run is also written to a JSONL log in ~/.code-ai/logs (move it with AGENT_LOG_DIR in .env).`}
          >
            <Segmented
              label="Console log level"
              value={draft.logLevel}
              options={LOG_LEVELS.map((level) => ({
                value: level,
                title: level.charAt(0).toUpperCase() + level.slice(1),
                detail: LOG_TEXT[level],
              }))}
              onChange={(level) => set('logLevel', level)}
            />
          </Row>
        </Card>
      </form>

      <FormActions>
        <Button
          variant="plain"
          className="mr-auto"
          disabled={isDefault || isSaving}
          onClick={() => {
            setDraft(toDraft(DEFAULT_AGENT_SETTINGS));
            setErrors({});
          }}
          title="Fill in the defaults; nothing changes until you save"
        >
          Reset to defaults
        </Button>
        <Button onClick={() => navigate(backTo)}>{isDirty ? 'Cancel' : 'Back'}</Button>
        <Button
          variant="primary"
          type="submit"
          form="settings-form"
          disabled={!isDirty || isSaving}
        >
          {isSaving && <Spinner size={13} />}
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </FormActions>
    </div>
  );
}

/** A small input, select or text box that sits at the end of a one-line setting row. */
const CONTROL =
  'h-7 rounded-md border bg-surface px-2 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:ring-1 focus:ring-accent focus-visible:outline-none';

/** A titled group of one-line setting rows; its explanation sits behind an info icon. */
function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="flex items-center gap-1 border-b border-line bg-subtle px-3 py-1">
        <h2 className="text-[12px] font-bold text-ink">{title}</h2>
        {hint && <InfoTip text={hint} />}
      </div>
      <div className="flex flex-col divide-y divide-line-2">{children}</div>
    </section>
  );
}

/** One setting on one line: its name (with an info tip) on the left, its control on the right. */
function Row({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  /** the control's id, when it's an input or select the label can point at */
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="px-3 py-1">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-1">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="truncate text-[12px] font-medium text-ink">
              {label}
            </label>
          ) : (
            <span className="truncate text-[12px] font-medium text-ink">{label}</span>
          )}
          {hint && <InfoTip text={hint} />}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{children}</div>
      </div>
      {error && (
        <p role="alert" className={`${ERROR} text-right`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** A small segmented control: one of a few options, each with its detail as a tooltip. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; title: string; detail: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-md border border-line bg-surface-2 p-0.5"
    >
      {options.map((option) => {
        const isOn = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isOn}
            title={option.detail}
            onClick={() => onChange(option.value)}
            className={`h-6 whitespace-nowrap rounded px-2 text-[11.5px] font-medium transition-colors ${
              isOn
                ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]'
                : 'text-ink-3 hover:text-ink'
            }`}
          >
            {option.title}
          </button>
        );
      })}
    </div>
  );
}

/** Picks a saved model for sub-agents or the reviewer; empty means the model of the chat. */
function ModelPicker({
  id,
  label,
  hint,
  emptyLabel = 'Same as the chat',
  value,
  models,
  error,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  /** The option for no model of its own. */
  emptyLabel?: string;
  value: string | null;
  models: readonly ModelProfile[] | null;
  error: string | undefined;
  onChange: (id: string | null) => void;
}) {
  // A model deleted since still shows, so saving doesn't silently change it.
  const isMissing = value !== null && models !== null && !models.some((m) => m.id === value);
  return (
    <Row label={label} htmlFor={id} hint={hint} error={error}>
      <select
        id={id}
        value={value ?? ''}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value || null)}
        className={`${CONTROL} ${error ? INPUT_ERROR : INPUT_OK} w-56 pr-7`}
      >
        <option value="">{emptyLabel}</option>
        {models?.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
        {isMissing && (
          <option value={value}>
            {emptyLabel === 'None'
              ? 'Unavailable model (not used)'
              : "Deleted model (uses the chat's)"}
          </option>
        )}
      </select>
    </Row>
  );
}
