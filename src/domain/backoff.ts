// Half of each delay is randomized to de-correlate concurrent retries; the fixed half keeps it monotonic in attempt.
const JITTER_RATIO = 0.5;

export function backoffDelay(
  attempt: number,
  baseMs: number,
  capMs: number,
  rand: number,
): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError(`attempt must be a non-negative integer, got ${attempt}`);
  }
  if (!Number.isFinite(baseMs) || baseMs < 0) {
    throw new RangeError(`baseMs must be a non-negative finite number, got ${baseMs}`);
  }
  if (!Number.isFinite(capMs) || capMs < 0) {
    throw new RangeError(`capMs must be a non-negative finite number, got ${capMs}`);
  }
  // Positive assertion so NaN is rejected rather than slipping through a `rand < 0 || rand >= 1` check.
  if (!(rand >= 0 && rand < 1)) {
    throw new RangeError(`rand must be in [0, 1), got ${rand}`);
  }
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(exponential * (1 - JITTER_RATIO * rand));
}
