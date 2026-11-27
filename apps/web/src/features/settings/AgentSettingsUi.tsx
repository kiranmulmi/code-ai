// Building blocks for the Agent settings page: a section list with live summaries, stacked
// fields, choice cards, number fields with quick picks, a stepper and an on/off card.
import type { ReactNode } from 'react';
import { Switch } from '../../components/Switch';
import { INPUT_ERROR, INPUT_OK } from '../../components/form';
import { CONTROL } from './SettingsUi';

export type NavSection<Id extends string> = {
  id: Id;
  label: string;
  icon: ReactNode;
  /** the section's current value in a few words, e.g. "Ask first" */
  summary: string;
  isChanged: boolean;
  hasError: boolean;
};

/**
 * The page's sections as a list on the left (a scrolling row on small screens), each with
 * what it's set to now, a dot when it has unsaved changes and a mark when it has a problem.
 */
export function SectionNav<Id extends string>({
  sections,
  active,
  onSelect,
}: {
  sections: readonly NavSection<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
}) {
  return (
    <nav
      aria-label="Agent settings sections"
      className="-mx-1 flex shrink-0 gap-1 overflow-x-auto border-b border-line px-1 pb-2 md:sticky md:top-0 md:mx-0 md:w-56 md:flex-col md:gap-0.5 md:self-start md:overflow-visible md:border-b-0 md:border-r md:px-0 md:pb-0 md:pr-3"
    >
      {sections.map((section) => {
        const isActive = section.id === active;
        return (
          <button
            key={section.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(section.id)}
            className={`group flex shrink-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors md:w-full ${
              isActive ? 'bg-accent-soft' : 'hover:bg-subtle'
            }`}
          >
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors ${
                isActive
                  ? 'bg-accent text-on-accent'
                  : 'bg-surface-2 text-ink-2 group-hover:text-ink'
              }`}
            >
              {section.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="whitespace-nowrap text-[13px] font-semibold text-ink">
                  {section.label}
                </span>
                {section.hasError ? (
                  <span
                    className="grid h-3.5 w-3.5 place-items-center rounded-full bg-danger-line text-[9px] font-bold text-white"
                    title="Has a problem to fix"
                  >
                    !
                  </span>
                ) : (
                  section.isChanged && (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Unsaved changes" />
                  )
                )}
              </span>
              <span className="hidden truncate text-[11.5px] text-ink-3 md:block">
                {section.summary}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** The open section's title and what it's for. */
export function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-3">
      <h2 className="text-[15px] font-bold leading-tight text-ink">{title}</h2>
      <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{description}</p>
    </header>
  );
}

/**
 * One setting, stacked: its name and what it does above, its control below, then the range
 * and default. Edited settings get a mark and a way back to the saved value.
 */
export function Field({
  label,
  htmlFor,
  description,
  more,
  meta,
  error,
  isChanged = false,
  onRevert,
  children,
}: {
  label: string;
  /** the control's id, when it's an input or select the label can point at */
  htmlFor?: string;
  description?: string;
  /** a longer explanation, behind a "How it works" disclosure */
  more?: string;
  /** a line under the control, e.g. the range and default */
  meta?: ReactNode;
  error?: string;
  isChanged?: boolean;
  onRevert?: () => void;
  children: ReactNode;
}) {
  const labelClass = 'text-[13px] font-semibold text-ink';
  return (
    <div className="grid gap-x-6 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {htmlFor ? (
            <label htmlFor={htmlFor} className={labelClass}>
              {label}
            </label>
          ) : (
            <span className={labelClass}>{label}</span>
          )}
          {isChanged && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-px text-[10.5px] font-semibold text-accent-2">
              Edited
              {onRevert && (
                <button
                  type="button"
                  onClick={onRevert}
                  className="font-medium underline-offset-2 hover:underline"
                  title="Go back to the saved value"
                >
                  · undo
                </button>
              )}
            </span>
          )}
        </div>
        {description && <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{description}</p>}
      </div>
      <div className="min-w-0">
        {children}
        {error ? (
          <p role="alert" className="mt-1.5 text-[12px] text-danger">
            {error}
          </p>
        ) : (
          meta && <div className="mt-1 text-[11.5px] text-ink-4">{meta}</div>
        )}
        {more && (
          <details className="group mt-1.5">
            <summary className="cursor-pointer list-none text-[11.5px] font-medium text-ink-3 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
              <span className="inline-block transition-transform group-open:rotate-90">›</span> How
              it works
            </summary>
            <p className="mt-1 max-w-prose text-[12px] leading-relaxed text-ink-3">{more}</p>
          </details>
        )}
      </div>
    </div>
  );
}

/** A small "Default" or "Recommended" tag on a choice. */
function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-ink-3">
      {children}
    </span>
  );
}

export type Choice<T extends string> = {
  value: T;
  title: string;
  detail: string;
  icon?: ReactNode;
};

/** One of a few options as full-width cards, each with an icon, its title and what it means. */
export function ChoiceList<T extends string>({
  label,
  value,
  options,
  defaultValue,
  onChange,
  columns = 1,
}: {
  label: string;
  value: T;
  options: readonly Choice<T>[];
  /** marked with a "Default" tag */
  defaultValue?: T;
  onChange: (value: T) => void;
  columns?: 1 | 2 | 3;
}) {
  const grid = columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-2 ${grid}`}>
      {options.map((option) => {
        const isOn = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isOn}
            onClick={() => onChange(option.value)}
            className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
              isOn
                ? 'border-accent bg-accent-soft ring-1 ring-accent'
                : 'border-line bg-surface hover:border-line-strong hover:bg-subtle'
            }`}
          >
            {option.icon && (
              <span
                aria-hidden
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                  isOn ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-2'
                }`}
              >
                {option.icon}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-semibold text-ink">{option.title}</span>
                {option.value === defaultValue && <Tag>Default</Tag>}
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
                {option.detail}
              </span>
            </span>
            <span
              aria-hidden
              className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                isOn ? 'border-accent' : 'border-line-strong'
              }`}
            >
              {isOn && <span className="h-2 w-2 rounded-full bg-accent" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));

/**
 * A whole number: quick picks for the common values, or any value typed in the box. Big
 * numbers show their short form (400K) as you type.
 */
export function NumberChoice({
  id,
  value,
  unit,
  presets,
  defaultValue,
  format,
  hasError,
  onChange,
}: {
  id: string;
  value: string;
  unit: string;
  presets: readonly number[];
  defaultValue: number;
  /** how a value reads on a quick pick, e.g. 400K */
  format: (value: number) => string;
  hasError: boolean;
  onChange: (value: string) => void;
}) {
  const typed = toNumber(value);
  const showShort = Number.isFinite(typed) && typed >= 10_000;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Quick picks" className="flex flex-wrap gap-1.5">
        {presets.map((preset) => {
          const isOn = typed === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={isOn}
              onClick={() => onChange(String(preset))}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium tabular-nums transition-colors ${
                isOn
                  ? 'border-accent bg-accent-soft text-ink ring-1 ring-accent'
                  : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink'
              }`}
            >
              {format(preset)}
              {preset === defaultValue && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-4">
                  default
                </span>
              )}
            </button>
          );
        })}
      </div>
      <span className="text-[11.5px] text-ink-4">or</span>
      <div className="relative">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          aria-invalid={hasError ? true : undefined}
          onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ''))}
          className={`${CONTROL} ${hasError ? INPUT_ERROR : INPUT_OK} w-36 pr-14 text-right tabular-nums`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-3">
          {unit}
        </span>
      </div>
      {showShort && (
        <span aria-live="polite" className="text-[11.5px] font-semibold text-ink-3 tabular-nums">
          = {format(typed)}
        </span>
      )}
    </div>
  );
}

/** A small whole number changed one at a time with − and +. */
export function Stepper({
  id,
  value,
  min,
  max,
  unit,
  hasError,
  onChange,
}: {
  id: string;
  value: string;
  min: number;
  max: number;
  unit: string;
  hasError: boolean;
  onChange: (value: string) => void;
}) {
  const typed = toNumber(value);
  const current = Number.isFinite(typed) ? typed : min;
  const step = (by: number) => onChange(String(Math.min(max, Math.max(min, current + by))));
  const button =
    'grid h-8 w-8 place-items-center text-[15px] font-semibold text-ink-2 transition-colors hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex items-center gap-2">
      <div
        className={`inline-flex items-center overflow-hidden rounded-lg border bg-surface ${
          hasError ? 'border-danger-line' : 'border-line'
        }`}
      >
        <button
          type="button"
          aria-label="Fewer"
          disabled={current <= min}
          onClick={() => step(-1)}
          className={`${button} border-r border-line`}
        >
          −
        </button>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          aria-invalid={hasError ? true : undefined}
          onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ''))}
          className="h-8 w-12 bg-transparent text-center text-[13px] font-semibold text-ink tabular-nums outline-none"
        />
        <button
          type="button"
          aria-label="More"
          disabled={current >= max}
          onClick={() => step(1)}
          className={`${button} border-l border-line`}
        >
          +
        </button>
      </div>
      <span className="text-[12px] text-ink-3">{unit}</span>
    </div>
  );
}

/** A feature's on/off switch as a card, with what turning it on means. */
export function ToggleCard({
  title,
  description,
  isOn,
  onChange,
  isChanged = false,
  isFlat = false,
}: {
  title: string;
  description: string;
  isOn: boolean;
  onChange: (isOn: boolean) => void;
  isChanged?: boolean;
  /** a plain row inside a card, instead of a card of its own */
  isFlat?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-4 px-4 py-3 transition-colors ${
        isFlat
          ? isOn
            ? 'bg-accent-soft/60'
            : ''
          : `rounded-xl border ${isOn ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          <span
            className={`rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${
              isOn ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-3'
            }`}
          >
            {isOn ? 'On' : 'Off'}
          </span>
          {isChanged && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Edited" />}
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{description}</p>
      </div>
      <Switch isOn={isOn} onChange={onChange} label={title} />
    </div>
  );
}

/**
 * Settings that only matter when something else is on: shown greyed out and locked while
 * it's off, so you can see what turning it on gives you.
 */
export function DependentGroup({
  isEnabled,
  offNote,
  header,
  children,
}: {
  isEnabled: boolean;
  /** why the settings are locked, e.g. "Turn on sub-agents to change these." */
  offNote: string;
  /** the switch or choice they depend on, at the top of the same card and never locked */
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="panel min-w-0 overflow-hidden">
      {header && <div className="border-b border-line">{header}</div>}
      <fieldset disabled={!isEnabled} className="min-w-0">
        {!isEnabled && (
          <p className="border-b border-line bg-subtle px-4 py-2 text-[12px] text-ink-3">
            {offNote}
          </p>
        )}
        <div
          className={`flex flex-col divide-y divide-line-2 transition-opacity ${
            isEnabled ? '' : 'pointer-events-none select-none opacity-50'
          }`}
        >
          {children}
        </div>
      </fieldset>
    </div>
  );
}
