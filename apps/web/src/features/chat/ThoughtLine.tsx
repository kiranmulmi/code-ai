/** "12s", "1m 5s": how long the planning step thought, never under a second. */
export function thoughtDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const rest = seconds % 60;
  return rest ? `${Math.floor(seconds / 60)}m ${rest}s` : `${seconds / 60}m`;
}
