import { withoutSpokenTags } from '@app/shared';
import { Markdown } from '../../components/Markdown';
import { AlertCircleIcon } from '../../lib/icons';
import type { TextItem } from './conversation';
import { useSmoothText } from './useSmoothText';

/** Agent text outside the activity cards: the answer, or an error. */
export function TextBlock({ item }: { item: TextItem }) {
  // Streamed text plays out at a steady pace rather than in the bursts it arrives in.
  // A voice-mode reply's <spoken> tags aren't shown (their text is).
  const smooth = useSmoothText(withoutSpokenTags(item.text), item.isOpen && !item.isError);
  const text = smooth.text;
  const isStreaming = item.isOpen || smooth.isCatchingUp;
  if (!item.text.trim()) return null;

  if (item.isError) {
    return (
      <div
        role="alert"
        className="flex gap-3 rounded-xl bg-danger-bg px-3.5 py-3 text-[13.5px] text-ink [overflow-wrap:anywhere]"
      >
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-danger text-on-accent">
          <AlertCircleIcon size={12} />
        </span>
        <div className="min-w-0">
          <p className="mb-0.5 text-[12.5px] font-semibold text-danger">Something went wrong</p>
          <Markdown text={item.text} className="text-ink-2" />
        </div>
      </div>
    );
  }

  return (
    <div className="answer text-ink [overflow-wrap:anywhere]">
      <Markdown text={text} isStreaming={isStreaming} />
    </div>
  );
}
