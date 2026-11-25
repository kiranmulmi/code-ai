import { BoltIcon, ShieldIcon } from '../../lib/icons';

/**
 * The composer's Auto-approve switch: on, the agent runs tools (file changes, commands, MCP
 * tools) without asking, from the next approval of a run in progress and for later messages.
 * An icon button like its toolbar neighbours: off, a muted shield (the agent asks first); on, a
 * filled accent bolt on an accent tile, so it stands out and isn't left on unnoticed.
 */
export function AutoApproveToggle({
  isOn,
  onChange,
}: {
  isOn: boolean;
  onChange: (isOn: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label="Auto-approve"
      onClick={(event) => {
        // The composer focuses its text box on click; this is a control of its own.
        event.stopPropagation();
        onChange(!isOn);
      }}
      title={
        isOn
          ? 'Auto-approve is on: the agent changes files and runs commands without asking. Click to ask again.'
          : 'Auto-approve is off: the agent asks before changing files or running commands. Click to let it run tools without asking.'
      }
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
        isOn
          ? 'bg-accent-soft text-accent-2 hover:bg-accent-bg'
          : 'text-ink-3 hover:bg-accent-soft hover:text-accent-2'
      }`}
    >
      {isOn ? (
        <BoltIcon size={16} fill="currentColor" strokeWidth={1.2} />
      ) : (
        <ShieldIcon size={16} />
      )}
    </button>
  );
}
