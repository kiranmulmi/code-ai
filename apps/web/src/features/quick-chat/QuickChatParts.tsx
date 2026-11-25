import type { ReactNode } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { Markdown } from '../../components/Markdown';
import { Spinner } from '../../components/Spinner';
import {
  AlertCircleIcon,
  BulbIcon,
  CheckIcon,
  GlobeIcon,
  SearchIcon,
  SparkIcon,
  WandIcon,
} from '../../lib/icons';

/** One web tool call in a reply: a search or a page read. */
export interface ToolStep {
  id: string;
  name: string;
  label: string;
  state: 'running' | 'done' | 'failed';
}

/** One turn of the conversation as the panel shows it. */
export type Turn =
  { role: 'user'; content: string } | { role: 'assistant'; content: string; steps: ToolStep[] };

/** The small round mark that stands for the assistant. */
export function AssistantMark({ size = 26 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-on-accent shadow-accent"
    >
      <SparkIcon size={Math.round(size * 0.52)} />
    </span>
  );
}

/** "Searched …" / "Read …": what the reply looked up, as a short timeline. */
export function ToolSteps({ steps }: { steps: ToolStep[] }) {
  if (!steps.length) return null;
  return (
    <ol className="mb-2.5 flex flex-col gap-1" aria-label="Web activity">
      {steps.map((step) => {
        const isSearch = step.name === 'web_search';
        const verb =
          step.state === 'running'
            ? isSearch
              ? 'Searching'
              : 'Reading'
            : isSearch
              ? 'Searched'
              : 'Read';
        return (
          <li
            key={step.id}
            className="flex min-w-0 animate-rise items-center gap-2 text-[12.5px] text-ink-3"
          >
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ${
                step.state === 'failed'
                  ? 'bg-danger-bg text-danger'
                  : step.state === 'running'
                    ? 'bg-accent-soft text-accent'
                    : 'bg-surface-2 text-ink-3'
              }`}
            >
              {step.state === 'running' ? (
                <Spinner size={10} label={verb} />
              ) : step.state === 'failed' ? (
                <AlertCircleIcon size={11} />
              ) : isSearch ? (
                <SearchIcon size={11} />
              ) : (
                <GlobeIcon size={11} />
              )}
            </span>
            <span className="shrink-0 font-medium text-ink-2">{verb}</span>
            <span className="min-w-0 truncate" title={step.label}>
              {isSearch ? `“${step.label}”` : step.label}
            </span>
            {step.state === 'failed' && <span className="shrink-0 text-danger">failed</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Three dots that bounce while the model thinks. */
export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1.5" role="status" aria-label="Thinking">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
          className="h-1.5 w-1.5 animate-dot-bounce rounded-full bg-ink-3"
        />
      ))}
    </span>
  );
}

export function UserTurn({ text }: { text: string }) {
  return (
    <div className="flex animate-rise justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-accent px-3.5 py-2 text-[13.5px] leading-relaxed text-on-accent [overflow-wrap:anywhere]">
        {text}
      </div>
    </div>
  );
}

export function AssistantTurn({
  content,
  steps,
  isStreaming,
}: {
  content: string;
  steps: ToolStep[];
  isStreaming: boolean;
}) {
  const isWaiting = isStreaming && !content && !steps.some((step) => step.state === 'running');
  return (
    <div className="group flex animate-rise gap-2.5">
      <AssistantMark />
      <div className="min-w-0 flex-1 pt-0.5">
        <ToolSteps steps={steps} />
        {content ? (
          <Markdown
            text={content}
            isStreaming={isStreaming}
            className="text-[13.5px] leading-relaxed text-ink"
          />
        ) : isWaiting ? (
          <TypingDots />
        ) : null}
        {!isStreaming && content && (
          <div className="mt-1 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <CopyButton text={content} label="Copy reply" />
          </div>
        )}
      </div>
    </div>
  );
}

const SUGGESTIONS: { icon: ReactNode; title: string; prompt: string }[] = [
  {
    icon: <GlobeIcon size={14} />,
    title: "What's in the news today?",
    prompt: 'What are the top news stories today?',
  },
  {
    icon: <SearchIcon size={14} />,
    title: 'Look something up',
    prompt: 'What is the latest stable version of Node.js, and what changed in it?',
  },
  {
    icon: <BulbIcon size={14} />,
    title: 'Explain it simply',
    prompt: 'Explain how HTTPS keeps a connection private, in simple terms.',
  },
  {
    icon: <WandIcon size={14} />,
    title: 'Help me write',
    prompt: 'Help me write a short, friendly message asking a colleague for a code review.',
  },
];

/** What a fresh chat shows: a greeting and a few things to try. */
export function EmptyState({
  onPick,
  modelName,
  useWeb,
}: {
  onPick: (prompt: string) => void;
  modelName: string | null;
  useWeb: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col justify-end gap-5 px-1 pb-2 pt-6">
      <div className="flex flex-col items-start gap-3">
        <AssistantMark size={40} />
        <div>
          <h2 className="text-[19px] font-semibold tracking-tight text-ink">
            What do you want to know?
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-ink-3">
            {useWeb
              ? 'Answers from the web, with sources.'
              : 'Web search is off: answers come from the model alone.'}{' '}
            Not tied to a workspace, and gone when you close it.
            {modelName ? ` Using ${modelName}.` : ''}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SUGGESTIONS.map((item, index) => (
          <button
            key={item.title}
            type="button"
            onClick={() => onPick(item.prompt)}
            style={{ animationDelay: `${index * 40}ms` }}
            className="group flex animate-rise flex-col gap-2 rounded-xl border border-line bg-subtle p-3 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-2"
          >
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
              {item.icon}
            </span>
            <span className="text-[12.5px] font-medium leading-snug text-ink-2 group-hover:text-ink">
              {item.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A pill that turns the web tools on or off for this chat. */
export function WebToggle({ isOn, onChange }: { isOn: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      onClick={() => onChange(!isOn)}
      title={isOn ? 'Web search on: the model can search and read pages' : 'Web search off'}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors ${
        isOn
          ? 'border-accent-bg bg-accent-soft text-accent-2'
          : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2'
      }`}
    >
      <GlobeIcon size={12} />
      Web
      {isOn && <CheckIcon size={10} />}
    </button>
  );
}
