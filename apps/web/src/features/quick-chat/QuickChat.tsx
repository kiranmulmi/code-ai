import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { QuickChatEvent, QuickChatMessage } from '@app/shared';
import { errorMessage, requestStream } from '../../lib/api';
import {
  ChatIcon,
  CollapseIcon,
  ComposeIcon,
  CrossIcon,
  ExpandIcon,
  SendIcon,
  StopIcon,
} from '../../lib/icons';
import { readEventData } from '../../lib/sse';
import { useStoredState } from '../../lib/useStoredState';
import { useModelChoice } from '../chat/useModelChoice';
import {
  AssistantMark,
  AssistantTurn,
  EmptyState,
  UserTurn,
  WebToggle,
  type ToolStep,
  type Turn,
} from './QuickChatParts';
import { useQuickChatModel } from './useQuickChatModel';

function parseEvent(data: string): QuickChatEvent | null {
  try {
    const value: unknown = JSON.parse(data);
    return typeof value === 'object' && value !== null && 'type' in value
      ? (value as QuickChatEvent)
      : null;
  } catch {
    return null;
  }
}

/** On unless turned off (web search). */
const parseOnByDefault = (stored: string | null) => stored !== '0';
/** Off unless turned on (the larger panel). */
const parseOffByDefault = (stored: string | null) => stored === '1';
const serializeFlag = (on: boolean) => (on ? '1' : '0');

/** The reply being written: its text so far and the web steps it took. */
interface Live {
  content: string;
  steps: ToolStep[];
}

/**
 * The open quick chat: a panel docked in the bottom-right corner (or widened with Expand).
 * Its messages live only in this component's state: closing the panel unmounts it, so the
 * conversation is gone and the next one starts fresh. Nothing is saved on the server either
 * (POST /v1/quick-chat). The model can search the web and read pages unless Web is off.
 */
function QuickChatPanel({ onClose }: { onClose: () => void }) {
  const model = useQuickChatModel();
  // Only the reasoning effort comes from the chat's model picker; the model is the workspace's.
  const { choice } = useModelChoice();
  const [useWeb, setUseWeb] = useStoredState('quickChat.web', parseOnByDefault, serializeFlag);
  const [isWide, setIsWide] = useStoredState('quickChat.wide', parseOffByDefault, serializeFlag);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const running = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const isRunning = live !== null;

  // Closing (unmounting) stops a reply in progress.
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns, live, error]);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // The message box grows with what's typed, up to a few lines.
  useLayoutEffect(() => {
    const box = input.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [draft]);

  async function send(text: string) {
    const history: QuickChatMessage[] = [
      ...turns.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: text },
    ];
    setTurns((list) => [...list, { role: 'user', content: text }]);
    setDraft('');
    setError(null);
    const stop = new AbortController();
    running.current = stop;
    let current: Live = { content: '', steps: [] };
    const update = (next: Live) => {
      current = next;
      setLive(next);
    };
    update(current);
    try {
      const body = await requestStream(
        '/quick-chat',
        {
          messages: history,
          useWeb,
          ...(model ? { modelId: model.id } : {}),
          ...(model?.supportsReasoning && choice.effort ? { reasoningEffort: choice.effort } : {}),
        },
        stop.signal,
      );
      for await (const data of readEventData(body)) {
        const event = parseEvent(data);
        if (!event) continue;
        switch (event.type) {
          case 'text_delta':
            update({ ...current, content: current.content + event.text });
            break;
          case 'text_reset':
            update({ ...current, content: '' });
            break;
          case 'tool_start':
            update({
              ...current,
              steps: [
                ...current.steps,
                { id: event.id, name: event.name, label: event.label, state: 'running' },
              ],
            });
            break;
          case 'tool_end':
            update({
              ...current,
              steps: current.steps.map((step) =>
                step.id === event.id ? { ...step, state: event.ok ? 'done' : 'failed' } : step,
              ),
            });
            break;
          case 'done':
            update({ ...current, content: event.text || current.content });
            break;
          case 'error':
            setError(event.message);
            break;
        }
      }
    } catch (cause) {
      if (!stop.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (running.current === stop) running.current = null;
      const { content, steps } = current;
      const finished = steps.map((step) =>
        step.state === 'running' ? { ...step, state: 'failed' as const } : step,
      );
      if (content || finished.length) {
        setTurns((list) => [...list, { role: 'assistant', content, steps: finished }]);
      }
      setLive(null);
      input.current?.focus();
    }
  }

  function submit(text: string) {
    const clean = text.trim();
    if (clean && !isRunning) void send(clean);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(draft);
    }
  }

  function newChat() {
    running.current?.abort();
    setTurns([]);
    setLive(null);
    setError(null);
    setDraft('');
    input.current?.focus();
  }

  const isEmpty = turns.length === 0 && !isRunning;

  return (
    <section
      role="dialog"
      aria-label="Quick chat"
      className={`fixed bottom-[5.5rem] right-5 z-[60] flex animate-dialog-in flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-dialog transition-[width,height] duration-300 ease-emphasized ${
        isWide
          ? 'h-[min(820px,calc(100vh-7.5rem))] w-[min(760px,calc(100vw-2.5rem))]'
          : 'h-[min(640px,calc(100vh-7.5rem))] w-[min(420px,calc(100vw-2.5rem))]'
      }`}
    >
      {/* A soft accent glow behind the header, so the panel reads as its own place. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(120%_100%_at_0%_0%,var(--glow-1),transparent_70%)]"
      />

      <header className="relative flex items-center gap-2.5 px-4 pb-2.5 pt-3.5">
        <AssistantMark size={30} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-semibold leading-tight tracking-tight text-ink">
            Quick chat
          </h2>
          <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${model ? 'bg-success' : 'bg-ink-4'}`}
            />
            <span className="truncate">{model?.name ?? 'No model set up'}</span>
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          {!isEmpty && (
            <HeaderButton onClick={newChat} label="New chat (clears this one)">
              <ComposeIcon size={15} />
            </HeaderButton>
          )}
          <HeaderButton
            onClick={() => setIsWide(!isWide)}
            label={isWide ? 'Make smaller' : 'Make larger'}
            className="max-sm:hidden"
          >
            {isWide ? <CollapseIcon size={14} /> : <ExpandIcon size={14} />}
          </HeaderButton>
          <HeaderButton onClick={onClose} label="Close (clears the chat)">
            <CrossIcon size={14} />
          </HeaderButton>
        </div>
      </header>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto px-4">
        <div className={`mx-auto flex min-h-full flex-col ${isWide ? 'max-w-[640px]' : ''}`}>
          {isEmpty ? (
            <EmptyState onPick={submit} modelName={model?.name ?? null} useWeb={useWeb} />
          ) : (
            <div className="flex flex-col gap-5 py-3">
              {turns.map((turn, index) =>
                turn.role === 'user' ? (
                  <UserTurn key={index} text={turn.content} />
                ) : (
                  <AssistantTurn
                    key={index}
                    content={turn.content}
                    steps={turn.steps}
                    isStreaming={false}
                  />
                ),
              )}
              {live && <AssistantTurn content={live.content} steps={live.steps} isStreaming />}
              {error && (
                <p
                  role="alert"
                  className="ml-[34px] animate-rise rounded-xl border border-danger-line bg-danger-bg px-3 py-2 text-[12.5px] leading-snug text-danger"
                >
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={onSubmit} className="relative px-3 pb-3 pt-2">
        <div
          className={`mx-auto rounded-2xl border border-line bg-subtle transition-[border-color,box-shadow] focus-within:border-[color-mix(in_srgb,var(--accent)_55%,transparent)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_12%,transparent)] ${
            isWide ? 'max-w-[640px]' : ''
          }`}
        >
          <textarea
            ref={input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={useWeb ? 'Ask anything, or look something up…' : 'Ask anything…'}
            aria-label="Message"
            className="block max-h-40 w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-4"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <WebToggle isOn={useWeb} onChange={setUseWeb} />
            <div className="flex items-center gap-2">
              <span className="hidden text-[11px] text-ink-4 sm:inline">
                {isRunning ? 'Esc closes' : '⏎ send · ⇧⏎ new line'}
              </span>
              {isRunning ? (
                <button
                  type="button"
                  onClick={() => running.current?.abort()}
                  aria-label="Stop"
                  title="Stop"
                  className="grid h-8 w-8 place-items-center rounded-full bg-ink text-surface transition-transform hover:scale-105"
                >
                  <StopIcon size={12} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!draft.trim() || !model}
                  aria-label="Send"
                  title="Send"
                  className="grid h-8 w-8 place-items-center rounded-full bg-accent text-on-accent shadow-accent transition-[background-color,transform,opacity] hover:scale-105 hover:bg-accent-hover disabled:scale-100 disabled:opacity-35 disabled:shadow-none"
                >
                  <SendIcon size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}

function HeaderButton({
  onClick,
  label,
  className = '',
  children,
}: {
  onClick: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A floating button in the bottom-right corner that opens the quick chat: a conversation with
 * a model outside any workspace, with web search, kept in memory only.
 */
export function QuickChat() {
  const [isOpen, setIsOpen] = useState(false);
  return createPortal(
    <>
      {isOpen && <QuickChatPanel onClose={() => setIsOpen(false)} />}
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close quick chat' : 'Open quick chat'}
        title={isOpen ? 'Close quick chat' : 'Quick chat (not saved)'}
        className={`group fixed bottom-5 right-5 z-[60] grid h-12 w-12 place-items-center rounded-full shadow-float ring-1 transition-[background-color,transform,box-shadow] duration-200 ease-emphasized hover:-translate-y-0.5 ${
          isOpen
            ? 'bg-surface-2 text-ink ring-line-strong'
            : 'bg-gradient-to-br from-accent to-accent-2 text-on-accent shadow-accent ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]'
        }`}
      >
        <span
          className={`grid place-items-center transition-transform duration-200 ease-emphasized ${
            isOpen ? 'rotate-90' : 'group-hover:scale-110'
          }`}
        >
          {isOpen ? <CrossIcon size={16} /> : <ChatIcon size={20} />}
        </span>
      </button>
    </>,
    document.body,
  );
}
