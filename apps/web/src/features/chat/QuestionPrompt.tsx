import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { QUESTION_LIMITS, type QuestionAnswer } from '@app/shared';
import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { QuestionIcon, SendIcon } from '../../lib/icons';
import type { OpenQuestion } from './conversation';

const NUMBER_TILE =
  'grid h-5 w-5 shrink-0 place-items-center rounded-md border border-line bg-surface text-[11px] font-medium text-ink-2';

const rowClass = (isActive: boolean) =>
  `rounded-xl border transition-colors ${
    isActive ? 'border-accent-bg bg-accent-soft' : 'border-transparent hover:bg-subtle'
  }`;

/**
 * A question the agent asked (ask_user), over the message box: pick an option (click, its
 * number, or the arrows and Enter), type something else, or skip (Esc). The run waits until
 * then. Rendered with `key={question.id}`, so each question starts fresh.
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
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // The agent is waiting on this, so the keyboard goes to it.
  useEffect(() => {
    optionRefs.current[0]?.focus();
  }, []);

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

  return (
    <section
      aria-label="The agent asks you"
      onKeyDown={onKeyDown}
      className="mx-auto w-full max-w-[1000px] px-4 pt-2 sm:px-6"
    >
      <div className="panel flex flex-col gap-3 rounded-l-none border-l-[3px] border-l-accent px-4 py-3.5 shadow-float">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <QuestionIcon size={16} className="mt-0.5 shrink-0 text-accent" />
            <p className="min-w-0 whitespace-pre-wrap break-words font-medium text-ink">
              {question.question}
            </p>
          </div>
          <Button
            variant="plain"
            size="sm"
            disabled={isSending}
            onClick={() => answer({ type: 'skipped' })}
          >
            Skip
          </Button>
        </div>

        <ul className="flex flex-col gap-1">
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
                className={`${rowClass(active === i)} flex w-full items-start gap-2.5 px-3 py-2 text-left outline-none disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className={`${NUMBER_TILE} mt-px`}>{i + 1}</span>
                <span className="min-w-0">
                  <span className="block break-words text-[13.5px] font-medium text-ink">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="block break-words text-[12.5px] text-ink-3">
                      {option.description}
                    </span>
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
          className={`${rowClass(active === otherRow)} -mt-1 flex items-center gap-2.5 py-1 pl-3 pr-1.5`}
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
            className="h-8 min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="submit"
            disabled={isSending || !ownAnswer.trim()}
            aria-label="Send this answer"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-on-accent transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendIcon size={13} />
          </button>
        </form>

        <div className="flex min-h-[18px] items-center gap-2 text-[12px] text-ink-3">
          {isSending ? (
            <Spinner size={12} label="Sending your answer" />
          ) : error ? (
            <span role="alert" className="text-danger">
              {error}
            </span>
          ) : (
            <span className="hidden sm:inline">
              ↑↓ to move · Enter or 1–{otherRow + 1} to pick · Esc to skip
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
