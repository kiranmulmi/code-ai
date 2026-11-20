import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { QUESTION_LIMITS, type QuestionAnswer } from '@app/shared';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Spinner } from '../../components/Spinner';
import { ChevronDownIcon, QuestionIcon, SendIcon } from '../../lib/icons';
import type { OpenQuestion } from './conversation';

const NUMBER_TILE =
  'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border border-line bg-surface text-[10.5px] font-medium text-ink-2';

const rowClass = (isActive: boolean) =>
  `rounded-lg border transition-colors ${
    isActive ? 'border-accent-bg bg-accent-soft' : 'border-transparent hover:bg-subtle'
  }`;

/**
 * A question the agent asked (ask_user), over the message box: pick an option (click, its
 * number, or the arrows and Enter), type something else, or skip (Esc). The run waits until
 * then. Rendered with `key={question.id}`, so each question starts fresh. It can be minimized
 * to a one-line bar (the question stays open) so the conversation and message box get the room.
 */
export function QuestionPrompt({
  question,
  onAnswer,
}: {
  question: OpenQuestion;
  onAnswer: (questionId: string, answer: QuestionAnswer) => void;
}) {
  const { id, options, isSending, error } = question;
  // Which row the keyboard is on: an option, or `otherRow` (the own-answer box).
  const otherRow = options.length;
  const [active, setActive] = useState(0);
  const [ownAnswer, setOwnAnswer] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // The agent is waiting on this, so the keyboard goes to it (again on each expand).
  useEffect(() => {
    if (!isMinimized) optionRefs.current[0]?.focus();
  }, [isMinimized]);

  const answer = (reply: QuestionAnswer) => {
    if (!isSending) onAnswer(id, reply);
  };
  const submitOwn = () => {
    const text = ownAnswer.trim();
    if (text) answer({ type: 'answered', text });
  };
  const moveTo = (row: number) => {
    const next = (row + otherRow + 1) % (otherRow + 1);
    setActive(next);
    if (next === otherRow) inputRef.current?.focus();
    else optionRefs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    const isTyping = event.target === inputRef.current;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo(active - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      answer({ type: 'skipped' });
    } else if (!isTyping && /^[1-9]$/.test(event.key)) {
      const row = Number(event.key) - 1;
      const option = options[row];
      if (option) {
        event.preventDefault();
        answer({ type: 'answered', text: option.label });
      } else if (row === otherRow) {
        event.preventDefault();
        moveTo(otherRow);
      }
    }
  };

  if (isMinimized) {
    return (
      <section
        aria-label="The agent asks you"
        className="mx-auto w-full max-w-[1000px] px-4 pt-2 sm:px-6"
      >
        <div className="panel flex animate-menu-up items-center gap-2 rounded-l-none border-l-[3px] border-l-accent py-1 pl-3 pr-1.5 shadow-float">
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            aria-expanded={false}
            title={question.question}
            className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left outline-none"
          >
            <QuestionIcon size={14} className="shrink-0 text-accent" />
            <span className="shrink-0 text-[12.5px] font-bold text-ink">Question</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">
              {question.question}
            </span>
            {isSending ? (
              <Spinner size={12} label="Sending your answer" />
            ) : (
              error && <span className="shrink-0 text-[12px] text-danger">Not sent</span>
            )}
            <ChevronDownIcon size={11} className="shrink-0 rotate-180 text-ink-3" />
          </button>
          <Button
            variant="plain"
            size="sm"
            disabled={isSending}
            onClick={() => answer({ type: 'skipped' })}
          >
            Skip
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="The agent asks you"
      onKeyDown={onKeyDown}
      className="mx-auto w-full max-w-[1000px] px-4 pt-2 sm:px-6"
    >
      <div className="panel flex max-h-[45vh] animate-rise flex-col gap-2 rounded-l-none border-l-[3px] border-l-accent px-3 py-2.5 shadow-float">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <QuestionIcon size={14} className="mt-0.5 shrink-0 text-accent" />
            <p className="min-w-0 whitespace-pre-wrap break-words text-[13.5px] font-medium text-ink">
              {question.question}
            </p>
          </div>
          <div className="-my-0.5 flex shrink-0 items-center gap-0.5">
            <Button
              variant="plain"
              size="sm"
              disabled={isSending}
              onClick={() => answer({ type: 'skipped' })}
            >
              Skip
            </Button>
            <IconButton
              aria-label="Minimize the question"
              aria-expanded
              title="Minimize"
              onClick={() => setIsMinimized(true)}
              className="h-7 w-7"
            >
              <ChevronDownIcon size={12} />
            </IconButton>
          </div>
        </div>

        <ul className="-mx-0.5 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-0.5">
          {options.map((option, i) => (
            <li key={option.label}>
              <button
                ref={(element) => {
                  optionRefs.current[i] = element;
                }}
                type="button"
                disabled={isSending}
                onFocus={() => setActive(i)}
                onClick={() => answer({ type: 'answered', text: option.label })}
                className={`${rowClass(active === i)} flex w-full items-start gap-2 px-2.5 py-1.5 text-left outline-none disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className={`${NUMBER_TILE} mt-px`}>{i + 1}</span>
                <span className="min-w-0 break-words text-[13px] leading-[18px]">
                  <span className="font-medium text-ink">{option.label}</span>
                  {option.description && (
                    <span className="text-[12px] text-ink-3"> · {option.description}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitOwn();
          }}
          className={`${rowClass(active === otherRow)} flex shrink-0 items-center gap-2 py-0.5 pl-2.5 pr-1`}
        >
          <span className={NUMBER_TILE}>{otherRow + 1}</span>
          <input
            ref={inputRef}
            value={ownAnswer}
            onChange={(event) => setOwnAnswer(event.target.value)}
            onFocus={() => setActive(otherRow)}
            disabled={isSending}
            maxLength={QUESTION_LIMITS.answerChars}
            placeholder="Something else…"
            aria-label="Your own answer"
            className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="submit"
            disabled={isSending || !ownAnswer.trim()}
            aria-label="Send this answer"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent text-on-accent transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendIcon size={12} />
          </button>
        </form>

        {(isSending || error) && (
          <div className="flex items-center gap-2 px-1 text-[12px] text-ink-3">
            {isSending ? (
              <Spinner size={12} label="Sending your answer" />
            ) : (
              <span role="alert" className="text-danger">
                {error}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
