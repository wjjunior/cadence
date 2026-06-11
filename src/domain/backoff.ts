// Fraction of each delay that is randomized to de-correlate concurrent retries
// (thundering herd); the remaining (1 - JITTER_RATIO) is the fixed floor, which
// keeps the delay monotonic in `attempt` for a fixed jitter value.
const JITTER_RATIO = 0.5;

// Exponential backoff capped at capMs, with jitter supplied by the caller so the
// function stays pure (no Math.random in the domain). `rand` is in [0, 1).
export function backoffDelay(
  attempt: number,
  baseMs: number,
  capMs: number,
  rand: number,
): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError(`attempt must be a non-negative integer, got ${attempt}`);
  }
  if (rand < 0 || rand >= 1) {
    throw new RangeError(`rand must be in [0, 1), got ${rand}`);
  }
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(exponential * (1 - JITTER_RATIO * rand));
}
