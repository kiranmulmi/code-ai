import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AiChip } from '../../components/AiWritingEditor';
import { Spinner } from '../../components/Spinner';
import { errorMessage } from '../../lib/api';
import { FileIcon, SparkIcon, WandIcon } from '../../lib/icons';

/** A one-click start: a card with a short title, a line under it, and the request it sends. */
export interface Starter {
  title: string;
  detail: string;
  icon: ReactNode;
  request: string;
}

/**
 * The plugin studio's right side, top part: a prompt box where you say what the tool should do
 * (starter cards while there's no code, quick changes once there is), and below it the code
 * itself, `tools.mjs`, in an editor with line numbers. The AI writes or rewrites the code;
 * Undo puts the previous code back.
 */
export function PluginCodePane({
  value,
  onChange,
  write,
  onUndo,
  onBusyChange,
  hasError,
  describedBy,
  placeholder,
  requestMaxLength,
  starters,
  refinements,
}: {
  value: string;
  onChange: (value: string) => void;
  write: (request: string, current: string) => Promise<string>;
  onUndo: () => void;
  onBusyChange: (isBusy: boolean) => void;
  hasError: boolean;
  describedBy: string;
  placeholder: string;
  requestMaxLength: number;
  starters: readonly Starter[];
  refinements: readonly AiChip[];
}) {
  const [request, setRequest] = useState('');
  const [isWriting, setIsWriting] = useState(false);
  const [before, setBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const hasCode = value.trim() !== '';

  const run = (asked: string) => {
    if (isWriting || (!asked.trim() && !hasCode)) return;
    setIsWriting(true);
    onBusyChange(true);
    setError(null);
    write(asked.trim(), value)
      .then((code) => {
        setBefore(value);
        onChange(code);
        setRequest('');
        editor.current?.focus();
      })
      .catch((cause: unknown) => setError(errorMessage(cause, "Couldn't write the code.")))
      .finally(() => {
        setIsWriting(false);
        onBusyChange(false);
      });
  };

  const undo = () => {
    if (before === null) return;
    onChange(before);
    onUndo();
    setBefore(null);
    editor.current?.focus();
  };

  const onPromptKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault(); // Enter asks; Shift+Enter is a new line; never the form's submit
    run(request);
  };

  const canWrite = !isWriting && (request.trim() !== '' || hasCode);
  const lineCount = (hasCode ? value : placeholder).split('\n').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* ---------- The prompt ---------- */}
      <div className="shrink-0">
        <div
          className={`rounded-2xl border bg-surface p-1.5 shadow-card transition-colors focus-within:border-accent focus-within:ring-1 focus-within:ring-accent ${
            isWriting ? 'border-accent' : 'border-line'
          }`}
        >
          <div className="flex items-start gap-2.5 px-2.5 pt-2">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-2">
              <SparkIcon size={13} />
            </span>
            <textarea
              rows={2}
              value={request}
              maxLength={requestMaxLength}
              disabled={isWriting}
              aria-label={
                hasCode ? 'Ask AI to change the code' : 'Describe the tool for AI to write'
              }
              placeholder={
                hasCode
                  ? 'Ask for a change, e.g. "add a tool that lists a 7-day forecast"'
                  : 'What should this tool do? e.g. "convert currencies with frankfurter.app"'
              }
              onChange={(event) => setRequest(event.target.value)}
              onKeyDown={onPromptKey}
              className="min-h-[44px] flex-1 resize-none bg-transparent pt-0.5 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-3 disabled:opacity-60"
            />
          </div>
          <div className="flex items-center gap-2 px-2 pb-1 pt-1">
            <span className="text-[11.5px] text-ink-3">
              <kbd className="font-sans font-semibold text-ink-2">Enter</kbd> to{' '}
              {hasCode ? 'apply' : 'write'} ·{' '}
              <kbd className="font-sans font-semibold text-ink-2">Shift+Enter</kbd> new line
            </span>
            <span className="ml-auto" />
            <button
              type="button"
              onClick={() => run(request)}
              disabled={!canWrite}
              title={request.trim() || !hasCode ? undefined : 'Tidy it up and fix what looks wrong'}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[12.5px] font-semibold text-on-accent shadow-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {isWriting ? <Spinner size={12} label="Writing" /> : <WandIcon size={13} />}
              {isWriting ? 'Writing…' : hasCode ? 'Rewrite with AI' : 'Write with AI'}
            </button>
          </div>
        </div>

        {hasCode ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[11.5px] font-semibold text-ink-3">Quick changes</span>
            {refinements.map((chip) => (
              <button
                key={chip.label}
                type="button"
                disabled={isWriting}
                onClick={() => run(chip.request)}
                className="h-7 rounded-full border border-line bg-surface px-3 text-[12px] text-ink-2 transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {starters.map((starter) => (
              <button
                key={starter.title}
                type="button"
                disabled={isWriting}
                onClick={() => run(starter.request)}
                title={starter.request}
                className="group flex items-start gap-2.5 rounded-xl border border-line bg-surface p-3 text-left transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2 transition-colors group-hover:bg-accent group-hover:text-on-accent">
                  {starter.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold text-ink">
                    {starter.title}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">
                    {starter.detail}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-2 text-[12.5px] text-danger">
            {error}
          </p>
        )}
      </div>

      {/* ---------- The code ---------- */}
      <div
        className={`relative flex min-h-[260px] flex-1 flex-col overflow-hidden rounded-2xl border bg-surface transition-colors focus-within:border-accent ${
          hasError ? 'border-danger-line' : 'border-line'
        }`}
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-subtle pl-2 pr-3">
          <span className="flex h-10 items-center gap-1.5 border-b-2 border-accent px-2 text-[12.5px] font-semibold text-ink">
            <FileIcon size={13} className="text-ft-js" />
            <span className="font-mono">tools.mjs</span>
          </span>
          {before !== null && !isWriting && (
            <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-accent-bg px-2.5 py-0.5 text-[11.5px] font-semibold text-accent-2">
              <SparkIcon size={10} /> Written by AI · review it
              <button type="button" onClick={undo} className="underline underline-offset-2">
                Undo
              </button>
            </span>
          )}
          <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-3">
            {hasCode ? `${lineCount} lines · ${value.length.toLocaleString()} chars` : 'empty'}
          </span>
        </div>

        <div className="relative flex min-h-0 flex-1">
          <div
            ref={gutter}
            aria-hidden
            className="w-11 shrink-0 select-none overflow-hidden border-r border-line-2 bg-subtle py-3.5 pr-2.5 text-right font-mono text-[12.5px] leading-[1.65] text-ink-4"
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <label htmlFor="plugin-code" className="sr-only">
            Code (tools.mjs)
          </label>
          <textarea
            ref={editor}
            id="plugin-code"
            value={value}
            readOnly={isWriting}
            maxLength={100_000}
            spellCheck={false}
            placeholder={placeholder}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            aria-busy={isWriting || undefined}
            onScroll={(event) => {
              if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
            }}
            onChange={(event) => {
              onChange(event.target.value);
              setBefore(null);
            }}
            className={`block min-w-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent px-4 py-3.5 font-mono text-[12.5px] leading-[1.65] text-ink outline-none [tab-size:2] placeholder:text-ink-4 ${
              isWriting ? 'opacity-40' : ''
            }`}
          />
          {isWriting && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="flex items-center gap-2.5 rounded-full border border-line bg-surface px-4 py-2 text-[12.5px] font-semibold text-ink shadow-float">
                <span className="text-accent">
                  <Spinner size={14} label="Writing" />
                </span>
                AI is writing tools.mjs…
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
