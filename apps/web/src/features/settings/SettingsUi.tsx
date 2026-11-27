// Building blocks shared by the settings pages (Agent settings, General).
import type { ReactNode } from 'react';
import { InfoTip } from '../../components/InfoTip';

/** An input or select at the end of a setting row. */
export const CONTROL =
  'h-8 rounded-lg border bg-surface px-2.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:ring-1 focus:ring-accent focus-visible:outline-none';

/** A titled card of settings: an icon, a title and a line about what's in it. */
export function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-2">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold leading-tight text-ink">{title}</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{description}</p>
        </div>
      </header>
      <div className="flex flex-col divide-y divide-line-2">{children}</div>
    </section>
  );
}

/** One setting: its name and a short line about it on the left, its control on the right. */
export function Row({
  label,
  htmlFor,
  description,
  hint,
  error,
  isWide = false,
  children,
}: {
  label: string;
  /** the control's id, when it's an input or select the label can point at */
  htmlFor?: string;
  description?: string;
  /** more detail, behind an info icon */
  hint?: string;
  error?: string;
  /** the control may take the full width on small screens */
  isWide?: boolean;
  children: ReactNode;
}) {
  const labelClass = 'text-[13px] font-semibold text-ink';
  return (
    <div className="px-4 py-3">
      <div
        className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 ${isWide ? '' : 'sm:flex-nowrap'}`}
      >
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex items-center gap-1">
            {htmlFor ? (
              <label htmlFor={htmlFor} className={labelClass}>
                {label}
              </label>
            ) : (
              <span className={labelClass}>{label}</span>
            )}
            {hint && <InfoTip text={hint} />}
          </div>
          {description && (
            <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{description}</p>
          )}
        </div>
        <div className={`flex shrink-0 items-center gap-2 ${isWide ? 'w-full sm:w-auto' : ''}`}>
          {children}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-right text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** A small segmented control: one of a few options, each with its detail as a tooltip. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; title: string; detail: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5"
    >
      {options.map((option) => {
        const isOn = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isOn}
            title={option.detail}
            onClick={() => onChange(option.value)}
            className={`h-7 whitespace-nowrap rounded-md px-2.5 text-[12px] font-medium transition-colors ${
              isOn
                ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]'
                : 'text-ink-3 hover:text-ink'
            }`}
          >
            {option.title}
          </button>
        );
      })}
    </div>
  );
}
