export interface HeartbeatRepository {
  beat(workerId: string): Promise<void>;
}
