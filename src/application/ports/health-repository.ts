export interface HealthSnapshot {
  heartbeatAgeMs: number | null;
  pending: number;
  oldestPendingAgeMs: number | null;
}

export interface HealthRepository {
  snapshot(): Promise<HealthSnapshot>;
}
