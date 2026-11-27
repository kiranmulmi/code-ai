import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  APPROVAL_MODES,
  DEFAULT_AGENT_SETTINGS,
  REVIEW_MODES,
  SETTINGS_LIMITS,
  agentSettingsSchema,
  type AgentSettings,
  type ApprovalMode,
  type ModelCategory,
  type ModelProfile,
  type ReviewMode,
} from '@app/shared';
import { Button } from '../../components/Button';
import { INPUT_ERROR, INPUT_OK } from '../../components/form';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { FormActions, usePageHeader } from '../../layout/pageHeader';
import { errorMessage } from '../../lib/api';
import { compactNumber, plural } from '../../lib/format';
import {
  BoltIcon,
  BrainIcon,
  BulbIcon,
  CheckIcon,
  DashIcon,
  EyeIcon,
  PulseIcon,
  ShieldIcon,
  WarnIcon,
  WrenchIcon,
} from '../../lib/icons';
import { fromPath } from '../../lib/routerState';
import { useToast } from '../../lib/toast';
import { ModelOptions } from '../models/ModelOptions';
import { useModels } from '../models/useModels';
import { fetchWorkspace } from '../workspaces/api';
import { fetchSettings, saveSettings } from './api';
import {
  ChoiceList,
  DependentGroup,
  Field,
  NumberChoice,
  SectionHeading,
  SectionNav,
  Stepper,
  ToggleCard,
  type Choice,
  type NavSection,
} from './AgentSettingsUi';
import { CONTROL } from './SettingsUi';
import { APP_NAME } from '../../lib/brand';

/** The form keeps numbers as typed text, so a half-typed value isn't snapped to a number. */
type NumberKey =
  'maxSteps' | 'maxTotalTokens' | 'maxInputChars' | 'maxParallelSubagents' | 'subagentMaxSteps';
type Draft = Omit<AgentSettings, NumberKey> & Record<NumberKey, string>;
type SettingKey = keyof AgentSettings;
type FieldErrors = Partial<Record<SettingKey, string>>;

const FIELDS: readonly string[] = Object.keys(DEFAULT_AGENT_SETTINGS);
const isField = (value: unknown): value is SettingKey =>
  typeof value === 'string' && FIELDS.includes(value);

const toDraft = (settings: AgentSettings): Draft => ({
  ...settings,
  maxSteps: String(settings.maxSteps),
  maxTotalTokens: String(settings.maxTotalTokens),
  maxInputChars: String(settings.maxInputChars),
  maxParallelSubagents: String(settings.maxParallelSubagents),
  subagentMaxSteps: String(settings.subagentMaxSteps),
});

const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));

const fromDraft = (draft: Draft) => ({
  ...draft,
  maxSteps: toNumber(draft.maxSteps),
  maxTotalTokens: toNumber(draft.maxTotalTokens),
  maxInputChars: toNumber(draft.maxInputChars),
  maxParallelSubagents: toNumber(draft.maxParallelSubagents),
  subagentMaxSteps: toNumber(draft.subagentMaxSteps),
});

const APPROVALS: Record<ApprovalMode, Omit<Choice<ApprovalMode>, 'value'>> = {
  ask: {
    title: 'Ask me first',
    detail: 'You approve each tool that writes files, runs commands or changes something.',
    icon: <ShieldIcon size={15} />,
  },
  auto: {
    title: 'Run without asking',
    detail: 'Tools that change things run straight away. Fastest, but you see changes after.',
    icon: <BoltIcon size={15} />,
  },
  deny: {
    title: 'Read-only',
    detail: 'The agent can only read and search. Anything that changes something is refused.',
    icon: <EyeIcon size={15} />,
  },
};

const REVIEWS: Record<ReviewMode, Omit<Choice<ReviewMode>, 'value'>> = {
  off: {
    title: 'Off',
    detail: 'Answers come straight to you.',
    icon: <DashIcon size={14} />,
  },
  tasks: {
    title: 'After tasks',
    detail: 'Checks answers to requests that used tools.',
    icon: <WrenchIcon size={14} />,
  },
  always: {
    title: 'Every answer',
    detail: 'Checks every answer, plain chat too.',
    icon: <CheckIcon size={14} />,
  },
};

const PLANNING: Choice<'off' | 'auto'>[] = [
  {
    value: 'off',
    title: 'Agent decides',
    detail:
      'Answers simple messages directly and makes a plan itself when a task has several steps.',
  },
  {
    value: 'auto',
    title: 'Planning step first',
    detail:
      'One extra model call before every message decides whether to plan. Steadier with smaller models, but slower.',
  },
];

/** Common values offered as one-click picks; any value in range can still be typed. */
const PRESETS: Record<Exclude<NumberKey, 'maxParallelSubagents'>, readonly number[]> = {
  maxSteps: [10, 30, 60, 100],
  maxTotalTokens: [200_000, 400_000, 1_000_000, 5_000_000],
  maxInputChars: [20_000, 50_000, 200_000],
  subagentMaxSteps: [6, 12, 25, 50],
};

const fmt = (value: number) => value.toLocaleString('en');

type SectionId = 'permissions' | 'planning' | 'limits' | 'subagents';

/** Which settings each section holds, for its unsaved-changes dot and error mark. */
const SECTION_FIELDS: Record<SectionId, readonly SettingKey[]> = {
  permissions: ['approval'],
  planning: ['planning', 'review', 'reviewModelId'],
  limits: ['maxSteps', 'maxTotalTokens', 'maxInputChars'],
  subagents: [
    'subagents',
    'subagentModelId',
    'maxParallelSubagents',
    'subagentMaxSteps',
    'subagentReasoning',
  ],
};
const SECTION_ORDER: readonly SectionId[] = ['permissions', 'planning', 'limits', 'subagents'];

/**
 * `/workspaces/:workspaceId/agent-settings`: how the agent behaves in one workspace
 * (permissions, planning and review, limits, sub-agents). Saved in the workspace's
 * .code-ai/<workspace>/agent-settings.json; until then it shows the app-wide defaults. Web
 * search and logging are app-wide (GeneralSettingsPage). Applies from the next message.
 *
 * Laid out as a list of sections on the left, each showing what it's set to now, and one
 * section open at a time on the right, so the page fits without a long scroll.
 */
export function AgentSettingsPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const backTo = fromPath(location.state) ?? (workspaceId ? `/workspaces/${workspaceId}` : '/');

  const [saved, setSaved] = useState<AgentSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [active, setActive] = useState<SectionId>('permissions');
  const models = useModels();

  usePageHeader({
    title: 'Agent settings',
    subtitle: workspaceName
      ? `How the agent behaves in ${workspaceName}. Changes apply from the next message.`
      : 'How the agent behaves in this workspace. Changes apply from the next message.',
    breadcrumbs: [
      { label: APP_NAME, to: backTo },
      ...(workspaceName ? [{ label: workspaceName, to: backTo }] : []),
      { label: 'Agent settings' },
    ],
  });

  useEffect(() => {
    if (!workspaceId) return;
    let isCurrent = true;
    Promise.all([fetchSettings(workspaceId), fetchWorkspace(workspaceId)])
      .then(([settings, workspace]) => {
        if (!isCurrent) return;
        setSaved(settings);
        setDraft(toDraft(settings));
        setWorkspaceName(workspace.name);
      })
      .catch((cause: unknown) => {
        if (isCurrent) setLoadError(cause);
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId]);

  if (!workspaceId) return <Navigate to="/" replace />;

  if (!draft || !saved) {
    return (
      <div className="w-full">
        {loadError ? (
          <p
            role="alert"
            className="rounded-xl border border-danger-line bg-danger-bg px-4 py-3 text-[13px] text-danger"
          >
            {errorMessage(loadError, "Couldn't load the agent settings.")}
          </p>
        ) : (
          <PageLoader />
        )}
      </div>
    );
  }

  const savedDraft = toDraft(saved);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft({ ...draft, [key]: value });
    if (isField(key)) setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const isChanged = (key: SettingKey) => draft[key] !== savedDraft[key];
  const revert = (key: SettingKey) => () => set(key, savedDraft[key]);

  // Settings that aren't on this page keep their values: the image model (picked in the
  // composer), and the SearXNG URL and log level (app-wide, in Preferences → General).
  const defaults = toDraft({
    ...DEFAULT_AGENT_SETTINGS,
    visionModelId: draft.visionModelId,
    searxngUrl: draft.searxngUrl,
    logLevel: draft.logLevel,
  });
  const isDirty = JSON.stringify(savedDraft) !== JSON.stringify(draft);
  const isDefault = JSON.stringify(defaults) === JSON.stringify(draft);
  const changeCount = FIELDS.filter((key) => isField(key) && isChanged(key)).length;

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
      // Open the first section with a problem, so it isn't hidden behind another one.
      const first = SECTION_ORDER.find((id) => SECTION_FIELDS[id].some((key) => found[key]));
      if (first) setActive(first);
      return;
    }
    setErrors({});
    setIsSaving(true);
    try {
      // The image model may have been picked in the composer since this page loaded: keep the
      // latest saved one, not the page's copy.
      const latest = await fetchSettings(workspaceId);
      const next = await saveSettings(workspaceId, {
        ...checked.data,
        visionModelId: latest.visionModelId,
      });
      setSaved(next);
      setDraft(toDraft(next));
      toast('Agent settings saved');
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't save the agent settings."), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const short = (key: NumberKey) => {
    const value = toNumber(draft[key]);
    return Number.isFinite(value) ? compactNumber(value) : '—';
  };

  const sections: NavSection<SectionId>[] = [
    {
      id: 'permissions',
      label: 'Permissions',
      icon: <ShieldIcon size={14} />,
      summary: APPROVALS[draft.approval].title,
    },
    {
      id: 'planning',
      label: 'Planning & review',
      icon: <BulbIcon size={14} />,
      summary: `${draft.planning === 'auto' ? 'Plans first' : 'Agent decides'} · review ${REVIEWS[draft.review].title.toLowerCase()}`,
    },
    {
      id: 'limits',
      label: 'Limits',
      icon: <PulseIcon size={14} />,
      summary: `${short('maxSteps')} steps · ${short('maxTotalTokens')} tokens`,
    },
    {
      id: 'subagents',
      label: 'Sub-agents',
      icon: <BrainIcon size={14} />,
      summary: draft.subagents ? `On · ${draft.maxParallelSubagents || '?'} at once` : 'Off',
    },
  ].map((section) => ({
    ...section,
    id: section.id as SectionId,
    isChanged: SECTION_FIELDS[section.id as SectionId].some(isChanged),
    hasError: SECTION_FIELDS[section.id as SectionId].some((key) => Boolean(errors[key])),
  }));

  /** A number setting with quick picks, its range and default under it. */
  const numberField = (
    key: Exclude<NumberKey, 'maxParallelSubagents'>,
    label: string,
    unit: string,
    description: string,
    more?: string,
  ) => {
    const { min, max } = SETTINGS_LIMITS[key];
    const isBig = max >= 100_000;
    const show = isBig ? compactNumber : fmt;
    return (
      <Field
        label={label}
        htmlFor={`setting-${key}`}
        description={description}
        more={more}
        meta={`Any whole number from ${show(min)} to ${show(max)}.`}
        error={errors[key]}
        isChanged={isChanged(key)}
        onRevert={revert(key)}
      >
        <NumberChoice
          id={`setting-${key}`}
          value={draft[key]}
          unit={unit}
          presets={PRESETS[key]}
          defaultValue={DEFAULT_AGENT_SETTINGS[key]}
          format={isBig ? compactNumber : fmt}
          hasError={Boolean(errors[key])}
          onChange={(value) => set(key, value)}
        />
      </Field>
    );
  };

  const panels: Record<SectionId, ReactNode> = {
    permissions: (
      <>
        <SectionHeading
          title="Permissions"
          description="What the agent may do beyond reading and searching. File tools always stay inside the workspace folder."
        />
        <ChoiceList
          label="Tool approvals"
          value={draft.approval}
          defaultValue={DEFAULT_AGENT_SETTINGS.approval}
          options={APPROVAL_MODES.map((m) => ({ value: m, ...APPROVALS[m] }))}
          onChange={(mode) => set('approval', mode)}
        />
        {draft.approval === 'auto' && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-warn-line bg-warn-bg px-3.5 py-2.5 text-[12px] leading-snug text-warn">
            <WarnIcon size={13} className="mt-px shrink-0" />
            Writes files and runs commands without asking. A few catastrophic commands are still
            refused, but commands run with your user&apos;s permissions.
          </p>
        )}
      </>
    ),

    planning: (
      <>
        <SectionHeading
          title="Planning & review"
          description="Extra model calls before and after the work. They can make answers steadier, at the cost of time and tokens."
        />
        <div className="flex flex-col gap-4">
          <div>
            <GroupLabel isChanged={isChanged('planning')}>Before each message</GroupLabel>
            <ChoiceList
              label="Planning"
              value={draft.planning}
              defaultValue={DEFAULT_AGENT_SETTINGS.planning}
              options={PLANNING}
              columns={2}
              onChange={(mode) => set('planning', mode)}
            />
          </div>
          <div>
            <GroupLabel isChanged={isChanged('review')}>Review the answer</GroupLabel>
            <ChoiceList
              label="Review answers"
              value={draft.review}
              defaultValue={DEFAULT_AGENT_SETTINGS.review}
              options={REVIEW_MODES.map((m) => ({ value: m, ...REVIEWS[m] }))}
              columns={3}
              onChange={(mode) => set('review', mode)}
            />
            <p className="mt-2 text-[11.5px] leading-snug text-ink-4">
              The reviewer sees the request, the plan, what the tools found and the answer, but not
              the rest of the chat. It can send an answer back once.
            </p>
          </div>
          <DependentGroup
            isEnabled={draft.review !== 'off'}
            offNote="Turn on review to pick the reviewer's model."
          >
            <ModelPicker
              id="setting-review-model"
              label="Reviewer model"
              description="A different model from the agent's catches more blind spots."
              value={draft.reviewModelId}
              models={models.data}
              category="chat"
              error={errors.reviewModelId}
              isChanged={isChanged('reviewModelId')}
              onRevert={revert('reviewModelId')}
              onChange={(id) => set('reviewModelId', id)}
            />
          </DependentGroup>
        </div>
      </>
    ),

    limits: (
      <>
        <SectionHeading
          title="Limits per message"
          description="Guardrails that stop a single message from running away. The agent stops and tells you when it hits one."
        />
        <div className="panel flex flex-col divide-y divide-line-2">
          {numberField(
            'maxSteps',
            'Working steps',
            'steps',
            'How many model calls that can use tools one message may take.',
            "Planning and summaries don't count. Long refactors or research may need more; simple chats rarely use more than a few.",
          )}
          {numberField(
            'maxTotalTokens',
            'Token budget',
            'tokens',
            'Input and output tokens one message may use in total, sub-agents included.',
            'Input the provider reads from its cache counts at a tenth, so long chats cost less than they look.',
          )}
          {numberField(
            'maxInputChars',
            'Longest message',
            'chars',
            'Messages you send that are longer than this are rejected.',
          )}
        </div>
      </>
    ),

    subagents: (
      <>
        <SectionHeading
          title="Sub-agents"
          description="Let the agent hand self-contained parts of a task to specialists that work in parallel."
        />
        <div className="flex flex-col gap-3">
          <DependentGroup
            isEnabled={draft.subagents}
            offNote="Turn on sub-agents to change these."
            header={
              <ToggleCard
                isFlat
                title="Use sub-agents"
                description="A researcher, coder, reviewer, writer, or your own from .code-ai/<workspace>/agents/. Each works in a fresh context and reports back."
                isOn={draft.subagents}
                isChanged={isChanged('subagents')}
                onChange={(isOn) => set('subagents', isOn)}
              />
            }
          >
            <ModelPicker
              id="setting-subagent-model"
              label="Model"
              description="A cheaper or faster model often does well on delegated parts."
              value={draft.subagentModelId}
              models={models.data}
              category="chat"
              error={errors.subagentModelId}
              isChanged={isChanged('subagentModelId')}
              onRevert={revert('subagentModelId')}
              onChange={(id) => set('subagentModelId', id)}
            />
            <Field
              label="Working at once"
              htmlFor="setting-maxParallelSubagents"
              description="More started in one step wait their turn."
              meta={`From ${SETTINGS_LIMITS.maxParallelSubagents.min} to ${SETTINGS_LIMITS.maxParallelSubagents.max}, default ${DEFAULT_AGENT_SETTINGS.maxParallelSubagents}.`}
              error={errors.maxParallelSubagents}
              isChanged={isChanged('maxParallelSubagents')}
              onRevert={revert('maxParallelSubagents')}
            >
              <Stepper
                id="setting-maxParallelSubagents"
                value={draft.maxParallelSubagents}
                min={SETTINGS_LIMITS.maxParallelSubagents.min}
                max={SETTINGS_LIMITS.maxParallelSubagents.max}
                unit="sub-agents"
                hasError={Boolean(errors.maxParallelSubagents)}
                onChange={(value) => set('maxParallelSubagents', value)}
              />
            </Field>
            {numberField(
              'subagentMaxSteps',
              'Steps each',
              'steps',
              'Working steps one sub-agent may take, separate from the main limit.',
            )}
            <ToggleCard
              isFlat
              title="Let sub-agents reason"
              description="They think before acting. Much slower on every step; only for reasoning models."
              isOn={draft.subagentReasoning}
              isChanged={isChanged('subagentReasoning')}
              onChange={(isOn) => set('subagentReasoning', isOn)}
            />
          </DependentGroup>
          <p className="text-[11.5px] leading-snug text-ink-4">
            Sub-agents share the message&apos;s token budget and ask for approval like the agent
            does.
          </p>
        </div>
      </>
    ),
  };

  return (
    <div className="w-full">
      <form
        id="agent-settings-form"
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4 md:flex-row md:items-start md:gap-5"
      >
        <SectionNav sections={sections} active={active} onSelect={setActive} />
        {/* Keyed by section, so each one fades in when it's picked. */}
        <div key={active} className="min-w-0 max-w-4xl flex-1 animate-fade-in">
          {panels[active]}
        </div>
      </form>

      <FormActions>
        <Button
          variant="plain"
          className="mr-auto"
          disabled={isDefault || isSaving}
          onClick={() => {
            setDraft(defaults);
            setErrors({});
          }}
          title="Fill in the defaults; nothing changes until you save"
        >
          Reset to defaults
        </Button>
        {isDirty && (
          <span className="text-[12px] text-ink-3">{plural(changeCount, 'unsaved change')}</span>
        )}
        <Button onClick={() => navigate(backTo)}>{isDirty ? 'Cancel' : 'Back'}</Button>
        <Button
          variant="primary"
          type="submit"
          form="agent-settings-form"
          disabled={!isDirty || isSaving}
        >
          {isSaving && <Spinner size={13} />}
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </FormActions>
    </div>
  );
}

/** A small heading over a group of choices, with a dot when it has unsaved changes. */
function GroupLabel({ children, isChanged }: { children: ReactNode; isChanged: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
        {children}
      </span>
      {isChanged && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Edited" />}
    </div>
  );
}

/** Picks a saved model for sub-agents or the reviewer; empty means the chat's model. */
function ModelPicker({
  id,
  label,
  description,
  value,
  models,
  category,
  error,
  isChanged,
  onRevert,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: string | null;
  models: readonly ModelProfile[] | null;
  /** Listed first; any model can still be picked. */
  category: ModelCategory;
  error: string | undefined;
  isChanged: boolean;
  onRevert: () => void;
  onChange: (id: string | null) => void;
}) {
  // A model deleted since still shows, so saving doesn't silently change it.
  const isMissing = value !== null && models !== null && !models.some((m) => m.id === value);
  return (
    <Field
      label={label}
      htmlFor={id}
      description={description}
      error={error}
      isChanged={isChanged}
      onRevert={onRevert}
    >
      <select
        id={id}
        value={value ?? ''}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value || null)}
        className={`${CONTROL} ${error ? INPUT_ERROR : INPUT_OK} w-full pr-7 sm:w-72`}
      >
        <option value="">Same as the chat</option>
        <ModelOptions models={models} category={category} selectedId={value} />
        {isMissing && <option value={value}>Deleted model (uses the chat&apos;s)</option>}
      </select>
    </Field>
  );
}
