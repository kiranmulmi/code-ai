import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  PLUGIN_REQUEST_MAX_CHARS,
  pluginInputSchema,
  toPluginName,
  type Plugin,
  type PluginTestResult,
} from '@app/shared';
import { AiWritingEditor, type AiChip } from '../../components/AiWritingEditor';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { ERROR, HINT, INPUT, INPUT_ERROR, INPUT_OK, LABEL } from '../../components/form';
import { Modal } from '../../components/Modal';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { ApiError, errorMessage, isNotFound } from '../../lib/api';
import { PlayIcon, TrashIcon, WandIcon } from '../../lib/icons';
import { useToast } from '../../lib/toast';
import {
  createPlugin,
  deletePlugin,
  fetchPlugin,
  testPlugin,
  updatePlugin,
  writePluginCode,
} from './api';
import { envToText, parseEnvText, sampleArgs } from './envText';

type Field = 'name' | 'description' | 'code' | 'env';
type Errors = Partial<Record<Field, string>>;
interface Draft {
  name: string;
  description: string;
  code: string;
  env: string;
}

const EMPTY: Draft = { name: '', description: '', code: '', env: '' };
const SECTION = 'px-5 py-4';
const CODE_HEIGHT = 'h-[max(160px,calc(88vh-640px))] sm:h-[max(200px,calc(88vh-560px))]';
const CODE_PLACEHOLDER = `// Describe your tool below and AI writes this file (tools.mjs).
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
const STARTERS = [
  'Get the current weather for a city from the free Open-Meteo API (no key needed)',
  'Look up a country by name with restcountries.com: capital, population, currency',
  'Count lines of code per file extension in the workspace folder',
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

  const footer = isClosing ? (
    <>
      <span role="alert" className="mr-auto text-[13px] text-ink-2">
        You have unsaved changes.
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
      <span className="ml-auto" />
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
        {isSaving && <Spinner size={12} />}
        {isSaving ? 'Saving…' : isEdit ? 'Save' : 'Create plugin'}
      </Button>
    </>
  );

  return (
    <>
      <Modal
        title={isEdit ? 'Edit tool plugin' : 'New tool plugin'}
        titleFont="sans"
        size="lg"
        onClose={requestClose}
        footer={footer}
      >
        {isLoading ? (
          <PageLoader />
        ) : (
          <form
            id="plugin-form"
            onSubmit={(event) => void submit(event)}
            noValidate
            className="divide-y divide-line-2"
          >
            <div className={`${SECTION} grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]`}>
              <div className="min-w-0">
                <label htmlFor="plugin-name" className={LABEL}>
                  Name
                </label>
                <input
                  id="plugin-name"
                  value={draft.name}
                  maxLength={40}
                  placeholder="weather"
                  autoFocus={!isEdit}
                  aria-invalid={errors.name ? true : undefined}
                  onChange={(event) => change('name', event.target.value)}
                  onBlur={() => change('name', toPluginName(draft.name))}
                  className={`${INPUT} ${errors.name ? INPUT_ERROR : INPUT_OK} font-mono`}
                />
                {errors.name && (
                  <p role="alert" className={ERROR}>
                    {errors.name}
                  </p>
                )}
                <p className={HINT}>
                  Lower-case words joined by hyphens. Its tools reach the agent as{' '}
                  <span className="break-all font-mono text-[12px]">
                    mcp__{toPluginName(draft.name) || 'name'}__&lt;tool&gt;
                  </span>
                </p>
              </div>
              <div className="min-w-0">
                <label htmlFor="plugin-description" className={LABEL}>
                  What it&apos;s for
                </label>
                <textarea
                  id="plugin-description"
                  rows={2}
                  value={draft.description}
                  maxLength={300}
                  placeholder="Weather lookups for any city."
                  onChange={(event) => change('description', event.target.value)}
                  className={`${INPUT} ${INPUT_OK} resize-y leading-relaxed`}
                />
                <p className={HINT}>For you, in the Tools tab. AI fills it in when empty.</p>
              </div>
            </div>

            <div className={SECTION}>
              <label htmlFor="plugin-code" className={LABEL}>
                Code <span className="font-normal text-ink-3">· tools.mjs, written by AI</span>
              </label>
              <AiWritingEditor
                id="plugin-code"
                value={draft.code}
                onChange={(value) => change('code', value)}
                write={writeCode}
                onUndo={undoDescription}
                onBusyChange={setIsWriting}
                hasError={Boolean(errors.code)}
                describedBy="plugin-code-hint"
                placeholder={CODE_PLACEHOLDER}
                maxLength={100_000}
                requestMaxLength={PLUGIN_REQUEST_MAX_CHARS}
                starters={STARTERS}
                refinements={REFINEMENTS}
                askPlaceholder={{
                  empty:
                    'Describe the tool and AI writes it, e.g. "convert currencies with frankfurter.app"',
                  filled: 'Ask AI to change it, e.g. "add a tool that lists forecasts for 7 days"',
                }}
                heightClass={CODE_HEIGHT}
                textClassName="font-mono text-[12.5px] [tab-size:2] whitespace-pre"
                failMessage="Couldn't write the code."
              />
              {errors.code && (
                <p role="alert" className={ERROR}>
                  {errors.code}
                </p>
              )}
              <p id="plugin-code-hint" className={HINT}>
                Runs with Node in its own process when the agent calls a tool, in the workspace
                folder, with only the variables below. Every call asks for your approval unless you
                allow the tool in the MCP tab. Read the code before you turn it on.
              </p>
            </div>

            <div className={SECTION}>
              <label htmlFor="plugin-env" className={LABEL}>
                Environment variables{' '}
                <span className="font-normal text-ink-3">· NAME=value per line, optional</span>
              </label>
              <textarea
                id="plugin-env"
                rows={2}
                value={draft.env}
                spellCheck={false}
                placeholder="WEATHER_API_KEY=…"
                aria-invalid={errors.env ? true : undefined}
                onChange={(event) => change('env', event.target.value)}
                className={`${INPUT} ${errors.env ? INPUT_ERROR : INPUT_OK} resize-y font-mono text-[12.5px]`}
              />
              {errors.env && (
                <p role="alert" className={ERROR}>
                  {errors.env}
                </p>
              )}
              <p className={HINT}>
                API keys and settings the code reads as <span className="font-mono">ctx.env</span>.
                Kept in the app&apos;s private MCP server settings, never sent to the AI writer
                (only their names are).
              </p>
            </div>

            <TestBench
              test={test}
              isTesting={isTesting}
              isFixing={isFixing}
              disabled={isBusy || !draft.code.trim()}
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

/** Check the code loads, pick a tool, call it with arguments, and send a failure to the AI. */
function TestBench({
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
    <div className={SECTION}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>Test</span>
        <span className="text-[12.5px] text-ink-3">
          Runs the code above (unsaved is fine) in the workspace folder.
        </span>
        <span className="ml-auto" />
        {canUndoFix && (
          <Button size="sm" variant="plain" onClick={onUndoFix}>
            Undo AI fix
          </Button>
        )}
        <Button size="sm" onClick={onCheck} disabled={disabled}>
          {isTesting && !tools.length ? <Spinner size={12} /> : null}
          Check it loads
        </Button>
      </div>

      {tools.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="min-w-0">
            <label htmlFor="plugin-test-tool" className="text-[12.5px] font-semibold text-ink">
              Tool
            </label>
            <select
              id="plugin-test-tool"
              value={tool}
              onChange={(event) => onPickTool(event.target.value)}
              className={`${INPUT} ${INPUT_OK} h-9 py-0 font-mono text-[12.5px]`}
            >
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            {picked?.description && (
              <p className="mt-1.5 text-[12px] leading-snug text-ink-3">{picked.description}</p>
            )}
          </div>
          <div className="min-w-0">
            <label htmlFor="plugin-test-args" className="text-[12.5px] font-semibold text-ink">
              Arguments <span className="font-normal text-ink-3">· JSON</span>
            </label>
            <textarea
              id="plugin-test-args"
              rows={4}
              value={args}
              spellCheck={false}
              onChange={(event) => onArgs(event.target.value)}
              className={`${INPUT} ${argsError ? INPUT_ERROR : INPUT_OK} resize-y font-mono text-[12.5px]`}
            />
            {argsError && (
              <p role="alert" className={ERROR}>
                {argsError}
              </p>
            )}
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="soft" onClick={onRun} disabled={disabled || !tool}>
                {isTesting ? <Spinner size={12} /> : <PlayIcon size={12} />}
                {isTesting ? 'Running…' : `Run ${tool}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {test && (
        <div className="mt-3" aria-live="polite">
          {test.error ? (
            <div className="rounded-xl border border-l-4 border-line border-l-danger-line bg-danger-bg p-3">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-[12.5px] text-danger">
                  Failed after {formatMs(test.ms)}
                </strong>
                <span className="ml-auto" />
                <Button size="sm" variant="primary" onClick={onFix} disabled={isFixing}>
                  {isFixing ? <Spinner size={12} /> : <WandIcon size={12} />}
                  {isFixing ? 'Fixing…' : 'Ask AI to fix'}
                </Button>
              </div>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">
                {test.error}
              </pre>
            </div>
          ) : (
            <div className="rounded-xl border border-l-4 border-line border-l-accent bg-subtle p-3">
              <strong className="text-[12.5px] text-ink">
                {test.output === null
                  ? `Loaded ${test.tools.length} tool${test.tools.length === 1 ? '' : 's'} in ${formatMs(test.ms)}`
                  : `Result in ${formatMs(test.ms)}`}
              </strong>
              {test.output !== null && (
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">
                  {test.output}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const formatMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
