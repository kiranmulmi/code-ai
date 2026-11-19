import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '../../components/Badge';
import { CodeHighlight } from '../../components/CodeHighlight';
import { CodeText } from '../../components/CodeText';
import { Spinner } from '../../components/Spinner';
import { inlineArgs, prettyJson } from '../../lib/format';
import { delegateInfo, specialistTitle, stepSummary } from './tools';
import { ChevronRightIcon, CrossIcon } from '../../lib/icons';
import { languageForPath } from '../../lib/languages';
import type { SubagentActivity, ToolItem } from './conversation';
import { toolIcon } from './toolIcon';
import { ToolInput } from './ToolInput';

/** A call's status: a spinner while it runs, a cross if it failed, else the tool's own icon. */
function StepIcon({ name, state }: { name: string; state: ToolItem['state'] }) {
  if (state === 'running') {
    return (
      <span className="grid h-5 w-5 place-items-center">
        <Spinner size={10} label="Running" />
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="grid h-5 w-5 place-items-center text-danger">
        <CrossIcon size={12} />
      </span>
    );
  }
  const Icon = toolIcon(name);
  return (
    <span className="grid h-5 w-5 place-items-center text-ink-3">
      <Icon size={13} />
    </span>
  );
}

/** How close to the end (px) still counts as "at the newest call". */
const NEAR_END = 24;

/**
 * A run of consecutive tool calls: a "Tool calls" header with their count, then plain rows on
 * the chat background, no card around them. Two rows show at once; the rest scroll inside a
 * capped box that stays on the newest call (unless the reader has scrolled up), with the older
 * calls fading out at the top edge.
 */
export function ToolSteps({ items }: { items: readonly ToolItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const isPinned = useRef(true);
  const [isFaded, setIsFaded] = useState(false);

  const update = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    isPinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_END;
    setIsFaded(node.scrollTop > 0);
  }, []);

  // A new call (not a row opened by the reader): follow it if we were at the end.
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && isPinned.current) node.scrollTop = node.scrollHeight;
    update();
  }, [items.length, update]);

  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-2.5 text-[11px] font-medium text-ink-3">
        <span>Tool calls</span>
        <span className="rounded-md bg-surface-2 px-1.5 text-[10.5px] tabular-nums text-ink-2">
          {items.length}
        </span>
      </div>
      <div
        ref={ref}
        onScroll={update}
        // Two rows (h-8 each, gap-px) show at once; the rest scroll. While a call is open the
        // cap (and the fade) lift, so its input and result show in full.
        className={`flex max-h-[calc(4rem+1px)] flex-col gap-px overflow-y-auto [&:has(details[open])]:max-h-none [&:has(details[open])]:[mask-image:none] [&>*]:shrink-0 ${
          isFaded ? '[mask-image:linear-gradient(to_bottom,transparent,black_1rem)]' : ''
        }`}
      >
        {items.map((item) => (
          <ToolStep key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}

/** read_file's header on a partial read: "[path: lines 1-200 of 333. …]". */
const READ_HEADER = /^\[[^\n]*: lines \d+-\d+ of \d+\.[^\n]*\]\n/;

/** The `path` argument of a call, if it has one. */
function pathArg(args: string): string | null {
  try {
    const parsed: unknown = JSON.parse(args);
    const path =
      typeof parsed === 'object' && parsed !== null ? (parsed as { path?: unknown }).path : null;
    return typeof path === 'string' ? path : null;
  } catch {
    return null;
  }
}

/**
 * A finished call's result: a file read is coloured as code for its file type (its line-range
 * header stays plain), anything else as before (JSON coloured, other text plain).
 */
function ResultText({ item }: { item: ToolItem }) {
  const path = item.name === 'read_file' ? pathArg(item.args) : null;
  const language = path ? languageForPath(path) : null;
  if (!language) return <CodeText text={prettyJson(item.result)} />;
  const header = READ_HEADER.exec(item.result)?.[0] ?? '';
  return (
    <>
      {header && <span className="text-ink-3">{header}</span>}
      <CodeHighlight code={item.result.slice(header.length)} language={language} />
    </>
  );
}

/** delegate_task: the sub-agent's tool calls, as small rows under the step, and what it's doing now. */
function SubagentSteps({ activity }: { activity: SubagentActivity }) {
  return (
    <div className="ml-[30px] flex flex-col gap-px border-l border-line-2 pl-2.5 text-[11px]">
      {activity.tools.map((tool) => (
        <div key={tool.id} className="flex h-6 items-center gap-2">
          <StepIcon name={tool.name} state={tool.state} />
          <span className="shrink-0 font-mono font-semibold italic text-ink-4">{tool.name}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-ink-4">
            {stepSummary(tool.args).text}
          </span>
        </div>
      ))}
      {activity.status && <div className="h-6 leading-6 text-ink-3">{activity.status}</div>}
    </div>
  );
}

/** One tool call. Click it to see the input and result, which open in a card below it. */
export function ToolStep({ item }: { item: ToolItem }) {
  if (!item.subagent) return <ToolCall item={item} />;
  return (
    <div className="flex flex-col">
      <ToolCall item={item} />
      <SubagentSteps activity={item.subagent} />
    </div>
  );
}

function ToolCall({ item }: { item: ToolItem }) {
  const delegated = item.name === 'delegate_task' ? delegateInfo(item.args) : null;
  const summary = delegated ? { text: delegated.label, isReason: true } : stepSummary(item.args);
  return (
    <details className="group text-[12.5px]">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2.5 rounded-lg px-2.5 text-[11px] transition-colors hover:bg-surface group-open:bg-surface [&::-webkit-details-marker]:hidden">
        <StepIcon name={item.name} state={item.state} />
        <span className="shrink-0 font-mono font-semibold italic text-ink-4">{item.name}</span>
        {delegated && (
          <Badge tone="blue" className="shrink-0">
            {specialistTitle(delegated.specialist)}
          </Badge>
        )}
        <span
          title={summary.isReason ? inlineArgs(item.args) : undefined}
          className={`min-w-0 flex-1 truncate ${
            summary.isReason ? 'text-[12px] text-ink-3' : 'font-mono text-ink-4'
          }`}
        >
          {summary.text}
        </span>
        {item.state === 'error' && <Badge tone="red">failed</Badge>}
        <ChevronRightIcon
          size={10}
          className="shrink-0 text-ink-4 transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="chat-card mb-2 ml-[30px] mt-1 grid gap-px overflow-hidden bg-line-2">
        <div className="bg-surface px-3 py-2.5">
          <div className="eyebrow mb-1.5">Input</div>
          <ToolInput tool={item.name} input={item.args} />
        </div>
        <div className="bg-surface px-3 py-2.5">
          <div className="eyebrow mb-1.5">Result</div>
          <pre
            className={`max-h-[260px] overflow-auto whitespace-pre-wrap font-mono text-[12px] [overflow-wrap:anywhere] ${
              item.state === 'error' ? 'text-danger' : 'text-ink-2'
            }`}
          >
            {item.state === 'error' ? item.result : <ResultText item={item} />}
          </pre>
        </div>
      </div>
    </details>
  );
}
