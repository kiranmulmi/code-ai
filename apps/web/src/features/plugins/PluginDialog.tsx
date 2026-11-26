import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  PLUGIN_REQUEST_MAX_CHARS,
  pluginInputSchema,
  toPluginName,
  type Plugin,
  type PluginTestResult,
} from '@app/shared';
import type { AiChip } from '../../components/AiWritingEditor';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { ERROR, INPUT, INPUT_ERROR, INPUT_OK } from '../../components/form';
import { IconButton } from '../../components/IconButton';
import { Modal } from '../../components/Modal';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { ApiError, errorMessage, isNotFound } from '../../lib/api';
import {
  CheckIcon,
  CrossIcon,
  FolderIcon,
  GlobeIcon,
  PlayIcon,
  RefreshIcon,
  ShieldIcon,
  SunIcon,
  TerminalIcon,
  TrashIcon,
  WandIcon,
  WarnIcon,
  WrenchIcon,
} from '../../lib/icons';
import { useToast } from '../../lib/toast';
import {
  createPlugin,
  deletePlugin,
  fetchPlugin,
  testPlugin,
  updatePlugin,
  writePluginCode,
} from './api';
import { EnvEditor } from './EnvEditor';
import { envToText, parseEnvText, sampleArgs } from './envText';
import { PluginCodePane, type Starter } from './PluginCodePane';

type Field = 'name' | 'description' | 'code' | 'env';
type Errors = Partial<Record<Field, string>>;
interface Draft {
  name: string;
  description: string;
  code: string;
  env: string;
}

const EMPTY: Draft = { name: '', description: '', code: '', env: '' };
const CODE_PLACEHOLDER = `// Describe your tool above and AI writes this file (tools.mjs).
export const tools = [
  {
    name: 'my_tool',
    description: 'What it does and when the agent should use it.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    async run(args, ctx) {
      return \`You said: \${args.text}\`;
    },
  },
];`;

/** One click: a request sent as it is. */
const STARTERS: readonly Starter[] = [
  {
    title: 'Weather',
    detail: 'Current weather for a city, Open-Meteo, no key',
    icon: <SunIcon size={15} />,
    request: 'Get the current weather for a city from the free Open-Meteo API (no key needed)',
  },
  {
    title: 'Country facts',
    detail: 'Capital, population, currency from restcountries.com',
    icon: <GlobeIcon size={15} />,
    request: 'Look up a country by name with restcountries.com: capital, population, currency',
  },
  {
    title: 'Code stats',
    detail: 'Lines of code per file type in this workspace',
    icon: <FolderIcon size={15} />,
    request: 'Count lines of code per file extension in the workspace folder',
  },
];
const REFINEMENTS: readonly AiChip[] = [
  { label: 'Fix bugs', request: '' },
  {
    label: 'Better descriptions',
    request:
      'Make every tool and property description clearer for the agent: what it does, when to use it, examples of values.',
  },
  {
    label: 'Stricter input checks',
    request: 'Validate every argument and throw clear errors for bad or missing input.',
  },
  {
    label: 'Smaller results',
    request:
      'Return only the fields that matter, trimmed, so the results stay short for the model.',
  },
];

/**
 * Make or edit a tool plugin (`name` null: a new one). The AI writes the code from a
 * description; Test runs it in its own process, and a failed test can go back to the AI to fix.
 * Saved app-wide; each workspace turns it on in the Tools tab.
 */
export function PluginDialog({
  name: pluginName,
  workspaceId,
  onClose,
  onSaved,
  onDeleted,
}: {
  name: string | null;
  workspaceId: string;
  onClose: () => void;
  /** `previousName`: the name before a rename, or null for a new plugin */
  onSaved: (plugin: Plugin, previousName: string | null) => void;
  onDeleted: (name: string) => void;
}) {
  const isEdit = pluginName !== null;
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saved, setSaved] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const descriptionBeforeAi = useRef<string | null>(null);

  // The test bench.
  const [test, setTest] = useState<PluginTestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [tool, setTool] = useState('');
  const [args, setArgs] = useState('{}');
  const [argsError, setArgsError] = useState<string | null>(null);
  const [codeBeforeFix, setCodeBeforeFix] = useState<string | null>(null);
  const [isFixing, setIsFixing] = useState(false);

  const isDirty =
    draft.name !== saved.name ||
    draft.description !== saved.description ||
    draft.code !== saved.code ||
    draft.env !== saved.env;
  const isBusy = isSaving || isWriting || isTesting || isFixing;

  useEffect(() => {
    if (!pluginName) return;
    let isCurrent = true;
    fetchPlugin(pluginName)
      .then((plugin) => {
        if (!isCurrent) return;
        const loaded = {
          name: plugin.name,
          description: plugin.description,
          code: plugin.code,
          env: envToText(plugin.env),
        };
        setDraft(loaded);
        setSaved(loaded);
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return;
        toast(
          isNotFound(cause)
            ? 'That plugin no longer exists.'
            : errorMessage(cause, "Couldn't load the plugin."),
          isNotFound(cause) ? 'warning' : 'error',
        );
        onClose();
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [pluginName, onClose, toast]);

  const change = (field: Field, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setIsClosing(false);
    if (field === 'code') setCodeBeforeFix(null);
  };

  const requestClose = () => {
    if (isDirty && !isClosing) setIsClosing(true);
    else onClose();
  };

  /** The env box as variables, or null (with the field's error shown) when a line is wrong. */
  const readEnv = (): Record<string, string> | null => {
    try {
      return parseEnvText(draft.env);
    } catch (cause) {
      setErrors((current) => ({ ...current, env: errorMessage(cause) }));
      return null;
    }
  };
  const envNames = () => {
    try {
      return Object.keys(parseEnvText(draft.env));
    } catch {
      return [];
    }
  };

  // ---------- AI writer ----------

  const takeDescription = (description: string) => {
    // A description the user wrote stays theirs; an empty one gets the suggestion.
    if (!draft.description.trim() && description) {
      descriptionBeforeAi.current = draft.description;
      setDraft((current) => ({ ...current, description }));
    } else {
      descriptionBeforeAi.current = null;
    }
  };

  const writeCode = async (request: string, code: string): Promise<string> => {
    const written = await writePluginCode({
      request,
      name: toPluginName(draft.name) || undefined,
      description: draft.description,
      code,
      envNames: envNames(),
    });
    takeDescription(written.description);
    setTest(null);
    return written.code;
  };

  const undoDescription = () => {
    const previous = descriptionBeforeAi.current;
    if (previous === null) return;
    setDraft((current) => ({ ...current, description: previous }));
    descriptionBeforeAi.current = null;
  };

  /** Sends the failed test's error to the AI, which fixes the code. */
  const fixWithAi = async () => {
    if (!test?.error) return;
    setIsFixing(true);
    try {
      const written = await writePluginCode({
        name: toPluginName(draft.name) || undefined,
        description: draft.description,
        code: draft.code,
        error: tool ? `Calling "${tool}" with ${args}:\n${test.error}` : test.error,
        envNames: envNames(),
      });
      setCodeBeforeFix(draft.code);
      setDraft((current) => ({ ...current, code: written.code }));
      setTest(null);
      toast('AI changed the code. Test it again.');
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't fix the code."), 'error');
    } finally {
      setIsFixing(false);
    }
  };

  // ---------- Test bench ----------

  const runTest = async (callTool: boolean) => {
    if (!draft.code.trim()) {
      setErrors((current) => ({ ...current, code: 'Write the code first (or ask AI to).' }));
      return;
    }
    const env = readEnv();
    if (!env) return;
    let parsedArgs: Record<string, unknown> = {};
    if (callTool) {
      try {
        const value: unknown = JSON.parse(args || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        parsedArgs = value as Record<string, unknown>;
        setArgsError(null);
      } catch {
        setArgsError('Arguments must be a JSON object, like {"city": "Kathmandu"}.');
        return;
      }
    }
    setIsTesting(true);
    try {
      const result = await testPlugin({
        code: draft.code,
        env,
        workspaceId,
        ...(callTool && tool ? { tool, args: parsedArgs } : {}),
      });
      setTest(result);
      // Pick the first tool (and sample arguments) when none is picked or it went away.
      if (!result.tools.some((t) => t.name === tool) && result.tools[0]) {
        setTool(result.tools[0].name);
        setArgs(sampleArgs(result.tools[0].inputSchema));
      }
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't run the test."), 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const pickTool = (name: string) => {
    setTool(name);
    const picked = test?.tools.find((t) => t.name === name);
    if (picked) setArgs(sampleArgs(picked.inputSchema));
    setArgsError(null);
  };

  // ---------- Save / delete ----------

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const env = readEnv();
    if (!env) return;
    const checked = pluginInputSchema.safeParse({
      name: toPluginName(draft.name),
      description: draft.description,
      code: draft.code,
      env,
    });
    if (!checked.success) {
      const next: Errors = {};
      for (const issue of checked.error.issues) {
        const field = issue.path[0];
        if (
          (field === 'name' || field === 'description' || field === 'code' || field === 'env') &&
          !next[field]
        ) {
          next[field] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setDraft((current) => ({ ...current, name: checked.data.name }));
    setIsSaving(true);
    setIsClosing(false);
    try {
      const plugin = pluginName
        ? await updatePlugin(pluginName, checked.data)
        : await createPlugin(checked.data);
      toast(isEdit ? 'Plugin saved' : 'Plugin created');
      onSaved(plugin, pluginName);
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && /name/i.test(cause.message)) {
        setErrors({ name: cause.message });
      } else {
        toast(errorMessage(cause, "Couldn't save the plugin."), 'error');
      }
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pluginName) return;
    setIsDeleting(true);
    try {
      await deletePlugin(pluginName);
      toast('Plugin deleted');
      onDeleted(pluginName);
      onClose();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't delete the plugin."), 'error');
      setIsDeleting(false);
      setIsDeleteOpen(false);
    }
  };
  const cancelDelete = useCallback(() => setIsDeleteOpen(false), []);

  const slug = toPluginName(draft.name);
  const hasCode = draft.code.trim() !== '';
  const hasPassed = Boolean(test && !test.error);
  const steps = [
    { label: 'Name it', done: slug !== '' },
    { label: 'Write the code', done: hasCode },
    { label: 'Test it', done: hasPassed },
  ];

  const header = (
    <div className="flex shrink-0 items-center gap-4 border-b border-line bg-surface py-3 pl-5 pr-3">
      <span className="brand-mark h-10 w-10 rounded-xl">
        <WrenchIcon size={18} />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[16px] font-bold text-ink">
            {isEdit ? 'Edit tool plugin' : 'New tool plugin'}
          </h2>
          {isDirty && isEdit && <Badge tone="yellow">Unsaved</Badge>}
        </div>
        <p className="truncate text-[12.5px] text-ink-3">
          Describe a tool, AI writes it, you test it, then turn it on in a workspace.
        </p>
      </div>
      <ol className="ml-auto hidden items-center gap-1 md:flex" aria-label="Progress">
        {steps.map((step, index) => (
          <li key={step.label} className="flex items-center gap-1">
            {index > 0 && (
              <span
                aria-hidden
                className={`h-px w-5 ${steps[index - 1]?.done ? 'bg-accent' : 'bg-line-strong'}`}
              />
            )}
            <span
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold transition-colors ${
                step.done ? 'bg-accent-soft text-accent-2' : 'text-ink-3'
              }`}
            >
              <span
                className={`grid h-4 w-4 place-items-center rounded-full text-[10px] tabular-nums ${
                  step.done ? 'bg-accent text-on-accent' : 'border border-line-strong'
                }`}
              >
                {step.done ? <CheckIcon size={9} /> : index + 1}
              </span>
              {step.label}
              <span className="sr-only">{step.done ? '(done)' : '(to do)'}</span>
            </span>
          </li>
        ))}
      </ol>
      <IconButton onClick={requestClose} aria-label="Close" className="ml-2 md:ml-3">
        <CrossIcon />
      </IconButton>
    </div>
  );

  const footer = isClosing ? (
    <>
      <span role="alert" className="mr-auto flex items-center gap-2 text-[13px] text-ink-2">
        <WarnIcon className="text-warn" /> You have unsaved changes.
      </span>
      <Button size="sm" onClick={() => setIsClosing(false)}>
        Keep editing
      </Button>
      <Button size="sm" variant="danger" onClick={onClose}>
        Discard and close
      </Button>
    </>
  ) : (
    <>
      {isEdit && (
        <Button
          size="sm"
          variant="danger-ghost"
          onClick={() => setIsDeleteOpen(true)}
          disabled={isSaving || isLoading}
        >
          <TrashIcon /> Delete
        </Button>
      )}
      <span className="mr-auto hidden items-center gap-1.5 text-[12px] text-ink-3 sm:flex">
        <ShieldIcon size={13} />
        {hasPassed
          ? 'Tested. Each call still asks for your approval.'
          : 'Saving without a test is fine; each call asks for your approval.'}
      </span>
      <Button size="sm" onClick={requestClose} disabled={isSaving}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant="primary"
        type="submit"
        form="plugin-form"
        disabled={isBusy || isLoading}
      >
        {isSaving ? <Spinner size={12} /> : <CheckIcon size={12} />}
        {isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Create plugin'}
      </Button>
    </>
  );

  return (
    <>
      <Modal
        title={isEdit ? `Edit tool plugin ${pluginName}` : 'New tool plugin'}
        size="wide"
        onClose={requestClose}
        header={header}
        footer={footer}
      >
        {isLoading ? (
          <PageLoader />
        ) : (
          <form
            id="plugin-form"
            onSubmit={(event) => void submit(event)}
            noValidate
            className="flex flex-col lg:grid lg:h-full lg:grid-cols-[320px_minmax(0,1fr)]"
          >
            {/* ---------- Left rail: what it is, and its secrets ---------- */}
            <aside className="flex flex-col gap-6 border-b border-line bg-subtle p-5 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
              <section>
                <h3 className="eyebrow">Identity</h3>
                <label
                  htmlFor="plugin-name"
                  className="mt-3 block text-[13px] font-semibold text-ink"
                >
                  Name
                </label>
                <input
                  id="plugin-name"
                  value={draft.name}
                  maxLength={40}
                  placeholder="weather"
                  autoFocus={!isEdit}
                  spellCheck={false}
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby="plugin-name-hint"
                  onChange={(event) => change('name', event.target.value)}
                  onBlur={() => change('name', toPluginName(draft.name))}
                  className={`${INPUT} ${errors.name ? INPUT_ERROR : INPUT_OK} font-mono text-[13.5px]`}
                />
                {errors.name && (
                  <p role="alert" className={ERROR}>
                    {errors.name}
                  </p>
                )}
                <div id="plugin-name-hint" className="mt-2 text-[12px] leading-snug text-ink-3">
                  Lower-case words joined by hyphens. The agent sees its tools as
                  <code className="mt-1.5 block truncate rounded-lg border border-line bg-surface px-2 py-1 font-mono text-[11.5px] text-ink-2">
                    mcp__<span className="font-semibold text-accent-2">{slug || 'name'}</span>
                    __&lt;tool&gt;
                  </code>
                </div>

                <label
                  htmlFor="plugin-description"
                  className="mt-5 flex items-baseline justify-between text-[13px] font-semibold text-ink"
                >
                  What it&apos;s for
                  <span className="text-[11px] font-normal tabular-nums text-ink-3">
                    {draft.description.length}/300
                  </span>
                </label>
                <textarea
                  id="plugin-description"
                  rows={3}
                  value={draft.description}
                  maxLength={300}
                  placeholder="Weather lookups for any city."
                  onChange={(event) => change('description', event.target.value)}
                  className={`${INPUT} ${INPUT_OK} resize-y text-[13.5px] leading-relaxed`}
                />
                <p className="mt-1.5 text-[12px] leading-snug text-ink-3">
                  Shown in the Tools tab. Leave it empty and AI fills it in.
                </p>
              </section>

              <section>
                <h3 className="eyebrow">Secrets &amp; settings</h3>
                <div className="mt-3">
                  <EnvEditor
                    value={draft.env}
                    onChange={(value) => change('env', value)}
                    hasError={Boolean(errors.env)}
                  />
                </div>
                {errors.env && (
                  <p role="alert" className={ERROR}>
                    {errors.env}
                  </p>
                )}
                <p className="mt-2 text-[12px] leading-snug text-ink-3">
                  The code reads them as <code className="font-mono">ctx.env</code>. Values stay in
                  the app&apos;s private settings; the AI writer only sees the names.
                </p>
              </section>

              <section
                id="plugin-code-hint"
                className="mt-auto rounded-xl border border-line border-l-4 border-l-accent bg-surface p-3.5"
              >
                <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                  <ShieldIcon size={13} className="text-accent-2" /> How it runs
                </h3>
                <ul className="mt-2 space-y-1.5 text-[12px] leading-snug text-ink-2">
                  <li>Node, in its own process, in the workspace folder.</li>
                  <li>Only the variables above, nothing else from your setup.</li>
                  <li>Every call asks for approval unless you allow it in the MCP tab.</li>
                  <li className="font-semibold text-ink">Read the code before you turn it on.</li>
                </ul>
              </section>
            </aside>

            {/* ---------- Main: AI prompt, code, test console ---------- */}
            <div className="flex min-w-0 flex-col gap-4 p-5 lg:min-h-0 lg:overflow-y-auto">
              <PluginCodePane
                value={draft.code}
                onChange={(value) => change('code', value)}
                write={writeCode}
                onUndo={undoDescription}
                onBusyChange={setIsWriting}
                hasError={Boolean(errors.code)}
                describedBy="plugin-code-hint"
                placeholder={CODE_PLACEHOLDER}
                requestMaxLength={PLUGIN_REQUEST_MAX_CHARS}
                starters={STARTERS}
                refinements={REFINEMENTS}
              />
              {errors.code && (
                <p role="alert" className="-mt-2 text-[13px] text-danger">
                  {errors.code}
                </p>
              )}

              <TestConsole
                test={test}
                isTesting={isTesting}
                isFixing={isFixing}
                disabled={isBusy || !hasCode}
                tool={tool}
                args={args}
                argsError={argsError}
                canUndoFix={codeBeforeFix !== null}
                onCheck={() => void runTest(false)}
                onRun={() => void runTest(true)}
                onPickTool={pickTool}
                onArgs={(value) => {
                  setArgs(value);
                  setArgsError(null);
                }}
                onFix={() => void fixWithAi()}
                onUndoFix={() => {
                  if (codeBeforeFix === null) return;
                  setDraft((current) => ({ ...current, code: codeBeforeFix }));
                  setCodeBeforeFix(null);
                }}
              />
            </div>
          </form>
        )}
      </Modal>

      {isEdit && (
        <ConfirmDeleteDialog
          open={isDeleteOpen}
          title="Delete this plugin?"
          message={
            <>
              <strong className="font-mono text-ink">{pluginName}</strong> and its tools are deleted
              from every workspace.
            </>
          }
          busy={isDeleting}
          onCancel={cancelDelete}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </>
  );
}

/**
 * The test console: check the code loads, pick one of its tools, call it with JSON arguments,
 * and see the result, or send a failure to the AI to fix.
 */
function TestConsole({
  test,
  isTesting,
  isFixing,
  disabled,
  tool,
  args,
  argsError,
  canUndoFix,
  onCheck,
  onRun,
  onPickTool,
  onArgs,
  onFix,
  onUndoFix,
}: {
  test: PluginTestResult | null;
  isTesting: boolean;
  isFixing: boolean;
  disabled: boolean;
  tool: string;
  args: string;
  argsError: string | null;
  canUndoFix: boolean;
  onCheck: () => void;
  onRun: () => void;
  onPickTool: (name: string) => void;
  onArgs: (value: string) => void;
  onFix: () => void;
  onUndoFix: () => void;
}) {
  const tools = test?.tools ?? [];
  const picked = tools.find((t) => t.name === tool);
  return (
    <section
      aria-labelledby="plugin-test-title"
      className="shrink-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-subtle px-4 py-2.5">
        <TerminalIcon size={15} className="text-ink-2" />
        <h3 id="plugin-test-title" className="text-[13px] font-semibold text-ink">
          Test console
        </h3>
        {test &&
          (test.error ? (
            <Badge tone="red">Failed · {formatMs(test.ms)}</Badge>
          ) : (
            <Badge tone="green" icon={<CheckIcon size={9} />}>
              {test.output === null
                ? `${test.tools.length} tool${test.tools.length === 1 ? '' : 's'} loaded`
                : 'Ran'}{' '}
              · {formatMs(test.ms)}
            </Badge>
          ))}
        <span className="ml-auto" />
        {canUndoFix && (
          <Button size="sm" variant="plain" onClick={onUndoFix}>
            Undo AI fix
          </Button>
        )}
        <Button size="sm" onClick={onCheck} disabled={disabled}>
          {isTesting && !tools.length ? <Spinner size={12} /> : <RefreshIcon size={12} />}
          {tools.length ? 'Reload' : 'Check it loads'}
        </Button>
      </div>

      {!test && !tools.length && (
        <p className="px-4 py-4 text-[12.5px] leading-relaxed text-ink-3">
          {disabled && !isTesting
            ? 'Write or generate the code above, then check it loads here.'
            : 'Runs the code above (unsaved is fine) in the workspace folder and lists its tools.'}
        </p>
      )}

      {tools.length > 0 && (
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
          <div className="min-w-0">
            <span id="plugin-test-tool" className="text-[12px] font-semibold text-ink">
              Tool
            </span>
            <div role="radiogroup" aria-labelledby="plugin-test-tool" className="mt-1.5 space-y-1">
              {tools.map((t) => {
                const isPicked = t.name === tool;
                return (
                  <button
                    key={t.name}
                    type="button"
                    role="radio"
                    aria-checked={isPicked}
                    onClick={() => onPickTool(t.name)}
                    className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                      isPicked
                        ? 'border-accent bg-accent-soft'
                        : 'border-line hover:border-line-strong hover:bg-subtle'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 ${
                        isPicked ? 'border-accent bg-accent' : 'border-line-strong'
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[12.5px] font-semibold text-ink">
                        {t.name}
                      </span>
                      {t.description && (
                        <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-ink-3">
                          {t.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex min-w-0 flex-col">
            <label htmlFor="plugin-test-args" className="text-[12px] font-semibold text-ink">
              Arguments <span className="font-normal text-ink-3">· JSON</span>
            </label>
            <textarea
              id="plugin-test-args"
              rows={5}
              value={args}
              spellCheck={false}
              onChange={(event) => onArgs(event.target.value)}
              className={`mt-1.5 w-full flex-1 resize-y rounded-xl border bg-subtle px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent ${
                argsError ? 'border-danger-line' : 'border-line hover:border-line-strong'
              }`}
            />
            {argsError && (
              <p role="alert" className={ERROR}>
                {argsError}
              </p>
            )}
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="primary" onClick={onRun} disabled={disabled || !tool}>
                {isTesting ? <Spinner size={12} /> : <PlayIcon size={11} />}
                {isTesting ? 'Running…' : `Run ${picked?.name ?? tool}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {test && (test.error || test.output !== null) && (
        <div aria-live="polite" className="border-t border-line">
          <div className="flex items-center gap-2 px-4 pt-3">
            <span
              className={`text-[11px] font-bold uppercase tracking-[0.12em] ${
                test.error ? 'text-danger' : 'text-accent-2'
              }`}
            >
              {test.error ? 'Error' : 'Output'}
            </span>
            <span className="ml-auto" />
            {test.error && (
              <Button size="sm" variant="primary" onClick={onFix} disabled={isFixing}>
                {isFixing ? <Spinner size={12} /> : <WandIcon size={12} />}
                {isFixing ? 'Fixing…' : 'Ask AI to fix'}
              </Button>
            )}
          </div>
          <pre
            className={`m-4 mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-l-4 bg-subtle p-3 font-mono text-[12px] leading-relaxed text-ink ${
              test.error ? 'border-line border-l-danger-line' : 'border-line border-l-accent'
            }`}
          >
            {test.error ?? test.output}
          </pre>
        </div>
      )}
    </section>
  );
}

const formatMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
