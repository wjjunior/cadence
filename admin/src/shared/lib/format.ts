const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Compact relative time ("just now", "5m", "3h", "2d"), with an absolute
// fallback past a week. `now` is injectable so the formatter stays pure/testable.
export function relativeTime(iso: string, now: number = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  return new Date(iso).toLocaleDateString();
}

// E.164 → grouped display, e.g. +15550001234 → +1 555 000 1234. Non-E.164 input
// is returned unchanged.
export function formatPhone(phone: string): string {
  const match = /^\+(\d)(\d{3})(\d{3})(\d{0,4})$/.exec(phone);
  if (!match) return phone;
  const [, country, area, prefix, line] = match;
  return `+${country} ${area} ${prefix} ${line}`.trim();
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
