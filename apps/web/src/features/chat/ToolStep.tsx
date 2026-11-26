import { useMemo, useState, type CSSProperties } from 'react';
import { parseCommandFiles } from '@app/shared';
import { inlineArgs } from '../../lib/format';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CrossIcon,
  FileTintIcon,
} from '../../lib/icons';
import type { SubagentActivity, ToolItem } from './conversation';
import { TimelineEntry } from './Timeline';
import { toolIcon } from './toolIcon';
import { FAMILY_COLOR, toolMeta } from './toolMeta';
import { ToolDetails } from './ToolDetails';
import { commandFilesSummary, delegateInfo, specialistTitle, stepSummary } from './tools';

/** A tinted square for a tool family: its colour faint behind, full on the glyph. */
function tint(color: string, strength = 14): CSSProperties {
  return {
    color,
    backgroundColor: `color-mix(in srgb, ${color} ${strength}%, var(--surface))`,
    borderColor: `color-mix(in srgb, ${color} 28%, transparent)`,
  };
}

/** A call's icon tile: the tool's glyph in its family colour. */
function ToolNode({ item, pop }: { item: ToolItem; pop: boolean }) {
  const { family } = toolMeta(item.name, item.args);
  const Icon = toolIcon(item.name);
  const isError = item.state === 'error';
  const color = isError ? 'var(--danger)' : FAMILY_COLOR[family];
  return (
    <span
      className={`grid h-5 w-5 shrink-0 place-items-center ${
        pop ? 'animate-pop motion-reduce:animate-none' : ''
      }`}
      style={{ color }}
    >
      {isError ? <CrossIcon size={12} /> : <Icon size={13} />}
    </span>
  );
}

/** The state at a row's right edge: a spinner while running, a check when done. */
function StateMark({ item }: { item: ToolItem }) {
  if (item.state === 'running') {
    return (
      <span
        role="status"
        aria-label="Running"
        className="h-3.5 w-3.5 animate-spin-fast rounded-full border-[1.5px] border-line-strong border-t-accent motion-reduce:animate-none"
      />
    );
  }
  if (item.state === 'error') {
    return (
      <span className="inline-flex h-5 items-center rounded-full bg-danger-bg px-2 text-[10.5px] font-semibold text-danger">
        Failed
      </span>
    );
  }
  return (
    <span aria-label="Done" className="grid h-4 w-4 place-items-center rounded-full text-success">
      <CheckIcon size={11} />
    </span>
  );
}

/** A running call's label: a light sweeping across it. */
const RUNNING_TEXT =
  'bg-[linear-gradient(90deg,var(--ink-3)_0%,var(--ink)_50%,var(--ink-3)_100%)] bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer motion-reduce:animate-none';

/** Runs longer than this fold their older calls behind a "show more" row. */
const FOLD_AFTER = 5;
/** How many of the newest calls stay visible while folded. */
const KEEP_VISIBLE = 3;

/**
 * A run of consecutive tool calls on the timeline. Long runs show only their newest calls,
 * with the older ones behind a single row that opens them.
 */
export function ToolSteps({ items }: { items: readonly ToolItem[] }) {
  const [isUnfolded, setIsUnfolded] = useState(false);
  // Calls already there when the run first shows (e.g. an old chat) don't animate in.
  const [initialKeys] = useState(() => new Set(items.map((item) => item.key)));
  const hidden = !isUnfolded && items.length > FOLD_AFTER ? items.length - KEEP_VISIBLE : 0;
  const shown = hidden ? items.slice(hidden) : items;
  return (
    <TimelineEntry>
      <ul className="-mx-2 flex flex-col">
        {hidden > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setIsUnfolded(true)}
              className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-ink-3 transition-colors hover:bg-subtle hover:text-ink"
            >
              Show {hidden} earlier tool {hidden === 1 ? 'call' : 'calls'}
              <ChevronDownIcon size={10} />
            </button>
          </li>
        )}
        {shown.map((item) => (
          <ToolStep key={item.key} item={item} isNew={!initialKeys.has(item.key)} />
        ))}
      </ul>
    </TimelineEntry>
  );
}

/** delegate_task: the sub-agent's own calls, as a small nested list under the step. */
function SubagentSteps({ activity }: { activity: SubagentActivity }) {
  if (!activity.tools.length && !activity.status) return null;
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-line-2 bg-subtle px-2.5 py-2">
      {activity.tools.map((tool) => {
        const meta = toolMeta(tool.name, tool.args);
        const Icon = toolIcon(tool.name);
        const color = tool.state === 'error' ? 'var(--danger)' : FAMILY_COLOR[meta.family];
        return (
          <div key={tool.id} className="flex h-6 items-center gap-2 text-[11.5px]">
            <span
              className="grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border"
              style={tint(color)}
            >
              {tool.state === 'error' ? <CrossIcon size={9} /> : <Icon size={9} />}
            </span>
            <span
              className={`shrink-0 font-semibold ${tool.state === 'running' ? RUNNING_TEXT : 'text-ink-2'}`}
            >
              {meta.label}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">
              {meta.target || stepSummary(tool.args).text}
            </span>
          </div>
        );
      })}
      {activity.status && (
        <div className="flex h-6 items-center gap-2 text-[11.5px] text-ink-3">
          <span aria-hidden className="live-dot scale-75" />
          {activity.status}
        </div>
      )}
    </div>
  );
}

/** One tool call. Click it to open its details (result, input, files touched) underneath. */
export function ToolStep({ item, isNew = false }: { item: ToolItem; isNew?: boolean }) {
  // Seen running: when it finishes, its icon pops in.
  const [wasRunning] = useState(item.state === 'running');
  const [isOpen, setIsOpen] = useState(false);
  const isRunning = item.state === 'running';
  const isError = item.state === 'error';
  const meta = toolMeta(item.name, item.args);
  const delegated = item.name === 'delegate_task' ? delegateInfo(item.args) : null;
  const summary = stepSummary(item.args);
  const reason = delegated ? delegated.label : summary.isReason ? summary.text : '';
  const target = meta.target || (summary.isReason ? '' : summary.text);
  const files = useMemo(
    () =>
      item.name === 'run_command' && item.state !== 'running' && item.state !== 'error'
        ? parseCommandFiles(item.result)
        : null,
    [item.name, item.state, item.result],
  );
  const filesSummary = files ? commandFilesSummary(files) : '';
  const color = isError ? 'var(--danger)' : FAMILY_COLOR[meta.family];

  return (
    <li className={isNew ? 'animate-enter motion-reduce:animate-none' : ''}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        title={reason ? inlineArgs(item.args) : undefined}
        className={`group flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-subtle ${
          isOpen ? 'bg-subtle' : ''
        }`}
      >
        <ToolNode item={item} pop={wasRunning && !isRunning} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
            <span className={`shrink-0 font-semibold ${isRunning ? RUNNING_TEXT : 'text-ink'}`}>
              {meta.label}
            </span>
            {delegated && (
              <span
                className="shrink-0 rounded-md border px-1.5 text-[10.5px] font-semibold leading-[18px]"
                style={tint(FAMILY_COLOR.agent, 10)}
              >
                {specialistTitle(delegated.specialist)}
              </span>
            )}
            {target && (
              <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-3">
                {target}
              </span>
            )}
          </span>
          {reason && (
            <span className="truncate text-[12px] leading-snug text-ink-3 group-hover:text-ink-2">
              {reason}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {filesSummary && (
            <span className="inline-flex h-5 items-center gap-1 rounded-full bg-surface-2 px-2 text-[10.5px] font-semibold text-ink-2">
              <FileTintIcon size={10} />
              {filesSummary}
            </span>
          )}
          <StateMark item={item} />
          <ChevronRightIcon
            size={10}
            className={`text-ink-4 transition-transform group-hover:text-ink-3 ${isOpen ? 'rotate-90' : ''}`}
          />
        </span>
      </button>
      {item.subagent && (
        <div className="pb-1.5 pl-[38px] pr-2">
          <SubagentSteps activity={item.subagent} />
        </div>
      )}
      {isOpen && (
        <div className="pb-1 pl-[38px] pr-2">
          <ToolDetails item={item} color={color} files={filesSummary ? files : null} />
        </div>
      )}
    </li>
  );
}
