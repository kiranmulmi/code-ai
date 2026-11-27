import type { ReactNode } from 'react';
import { SearchIcon } from '../../lib/icons';

/**
 * Building blocks shared by the Customize sections (Skills, Agents, Tools, MCP, Memory): a
 * page header with the section's main actions, a search box, a card grid and an empty state.
 */

/** The section's title, what it is for in one line, and its actions on the right. */
export function SectionHeader({
  icon,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-2"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-ink">{title}</h1>
          <p className="mt-0.5 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-3">
            {description}
          </p>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A filter box over a list; `count` says how many match while it has text. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  count,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  count?: number;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <label className="relative flex min-w-0 max-w-sm flex-1 items-center">
        <SearchIcon size={14} className="pointer-events-none absolute left-3 text-ink-3" />
        <span className="sr-only">{placeholder}</span>
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent focus:ring-1 focus:ring-accent"
        />
      </label>
      {value.trim() && count !== undefined && (
        <span className="text-[12.5px] text-ink-3" aria-live="polite">
          {count === 0 ? 'No matches' : `${count} ${count === 1 ? 'match' : 'matches'}`}
        </span>
      )}
    </div>
  );
}

/** Case-insensitive match of a search against some fields. */
export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

/** A small heading over a group of cards, with an optional count. */
export function GroupHeading({
  id,
  children,
  count,
  hint,
}: {
  id?: string;
  children: ReactNode;
  count?: number;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2">
      <h2 id={id} className="eyebrow">
        {children}
      </h2>
      {count !== undefined && (
        <span className="text-[11px] font-semibold tabular-nums text-ink-3">{count}</span>
      )}
      {hint && <span className="ml-auto text-[12px] text-ink-3">{hint}</span>}
    </div>
  );
}

/** Responsive cards: as many columns as fit, each at least 260px. */
export function CardGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul
      aria-label={label}
      className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]"
    >
      {children}
    </ul>
  );
}

/**
 * One item as a card: icon, name, badges, a description, and a footer with details and
 * controls. The whole card opens it (`onOpen`); `corner` and `footerEnd` stay clickable.
 */
export function ItemCard({
  icon,
  name,
  badges,
  description,
  meta,
  footerEnd,
  corner,
  onOpen,
  openTitle,
  isMuted = false,
}: {
  icon: ReactNode;
  name: string;
  badges?: ReactNode;
  description: ReactNode;
  meta?: ReactNode;
  footerEnd?: ReactNode;
  /** small actions at the top right, shown on hover (always on touch screens) */
  corner?: ReactNode;
  onOpen: () => void;
  openTitle: string;
  /** a quieter look, e.g. for built-ins */
  isMuted?: boolean;
}) {
  return (
    <li
      className={`group relative flex min-h-[148px] flex-col rounded-2xl border p-4 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-card ${
        isMuted ? 'border-dashed border-line bg-subtle' : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
            isMuted ? 'bg-surface-2 text-ink-3' : 'bg-accent-soft text-accent-2'
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <button
            type="button"
            onClick={onOpen}
            title={openTitle}
            className="block max-w-full truncate text-left font-mono text-[13px] font-semibold text-ink outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-accent"
          >
            {name}
          </button>
          {badges && <div className="mt-1 flex flex-wrap gap-1">{badges}</div>}
        </div>
        {corner && (
          <div className="relative z-10 -mr-1 -mt-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            {corner}
          </div>
        )}
      </div>
      <p className="mt-2.5 line-clamp-3 flex-1 text-[12.5px] leading-relaxed text-ink-2">
        {description}
      </p>
      {(meta || footerEnd) && (
        <div className="mt-3 flex min-h-6 items-center gap-2 border-t border-line-2 pt-2.5">
          <div className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">{meta}</div>
          {footerEnd && <div className="relative z-10 shrink-0">{footerEnd}</div>}
        </div>
      )}
    </li>
  );
}

/** A small icon button for a card's corner. */
export function CardAction({
  label,
  onClick,
  tone = 'default',
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-lg text-ink-3 transition-colors ${
        tone === 'danger'
          ? 'hover:bg-danger-bg hover:text-danger'
          : 'hover:bg-surface-2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** What shows when a section has nothing yet: a picture, why it's useful, and how to start. */
export function EmptyHero({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-subtle px-6 py-10 text-center">
      <span
        aria-hidden
        className="grid h-12 w-12 place-items-center rounded-2xl bg-surface text-accent shadow-card"
      >
        {icon}
      </span>
      <h2 className="mt-4 text-[15px] font-bold text-ink">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-[48ch] text-[13px] leading-relaxed text-ink-3">
        {children}
      </p>
      {actions && <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

/** A quiet "how this works" note at the end of a section. */
export function SectionNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 border-t border-line-2 pt-4 text-[12.5px] leading-relaxed text-ink-3">
      {children}
    </p>
  );
}

/** The width and padding every section's page shares. */
export function SectionPage({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-5 py-6 lg:px-8 lg:py-8">{children}</div>;
}
