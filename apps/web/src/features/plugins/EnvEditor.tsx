import { useState } from 'react';
import { EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from '../../lib/icons';
import { envRowsToText, envTextToRows, type EnvRow } from './envText';

const CELL =
  'h-8 w-full min-w-0 rounded-lg border bg-surface px-2.5 font-mono text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:ring-1 focus:ring-accent';

/**
 * The plugin's environment variables as rows of name and (hidden) value, or as plain
 * NAME=value text for pasting a .env. Reports the text form, which the dialog checks on save.
 */
export function EnvEditor({
  value,
  onChange,
  hasError,
}: {
  value: string;
  onChange: (text: string) => void;
  hasError: boolean;
}) {
  const [mode, setMode] = useState<'rows' | 'text'>('rows');
  const [rows, setRows] = useState<EnvRow[]>(() => envTextToRows(value));
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());

  const update = (next: EnvRow[]) => {
    setRows(next);
    onChange(envRowsToText(next));
  };
  const edit = (index: number, patch: Partial<EnvRow>) =>
    update(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const remove = (index: number) => {
    update(rows.filter((_, i) => i !== index));
    setShown(new Set());
  };
  const toggleShown = (index: number) =>
    setShown((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const switchMode = () => {
    if (mode === 'text') setRows(envTextToRows(value));
    setMode(mode === 'rows' ? 'text' : 'rows');
  };

  const border = hasError ? 'border-danger-line' : 'border-line hover:border-line-strong';

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span id="plugin-env-label" className="text-[13px] font-semibold text-ink">
          Environment variables
        </span>
        <button
          type="button"
          onClick={switchMode}
          className="rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-accent-2 transition-colors hover:bg-accent-soft"
        >
          {mode === 'rows' ? 'Paste as text' : 'Edit as list'}
        </button>
      </div>

      {mode === 'text' ? (
        <textarea
          id="plugin-env"
          aria-labelledby="plugin-env-label"
          rows={4}
          value={value}
          spellCheck={false}
          placeholder={'WEATHER_API_KEY=…\nUNITS=metric'}
          aria-invalid={hasError || undefined}
          onChange={(event) => onChange(event.target.value)}
          className={`mt-2 w-full resize-y rounded-xl border bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:ring-1 focus:ring-accent ${border}`}
        />
      ) : (
        <div className="mt-2 space-y-1.5" role="group" aria-labelledby="plugin-env-label">
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <input
                value={row.key}
                placeholder="NAME"
                spellCheck={false}
                aria-label={`Variable ${index + 1} name`}
                aria-invalid={hasError || undefined}
                onChange={(event) =>
                  edit(index, { key: event.target.value.replace(/[^A-Za-z0-9_]/g, '_') })
                }
                className={`${CELL} ${border} flex-[1.1]`}
              />
              <div className="relative min-w-0 flex-1">
                <input
                  value={row.value}
                  type={shown.has(index) ? 'text' : 'password'}
                  placeholder="value"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={`Variable ${index + 1} value`}
                  onChange={(event) => edit(index, { value: event.target.value })}
                  className={`${CELL} ${border} pr-7`}
                />
                <button
                  type="button"
                  onClick={() => toggleShown(index)}
                  aria-label={shown.has(index) ? 'Hide value' : 'Show value'}
                  className="absolute inset-y-0 right-1 grid w-6 place-items-center text-ink-3 hover:text-ink"
                >
                  {shown.has(index) ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
                </button>
              </div>
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove variable ${row.key || index + 1}`}
                className="grid h-8 w-7 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-danger-bg hover:text-danger"
              >
                <TrashIcon size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => update([...rows, { key: '', value: '' }])}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-[12px] font-semibold text-ink-2 transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent-2"
          >
            <PlusIcon size={11} /> Add variable
          </button>
        </div>
      )}
    </div>
  );
}
