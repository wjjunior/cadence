import type { HeartbeatRepository } from '../../application/ports/heartbeat-repository.js';

const noop = (): void => {};

export class HeartbeatBeater {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repo: HeartbeatRepository,
    private readonly workerId: string,
    private readonly intervalMs: number,
    private readonly onError: (error: unknown) => void = noop,
  ) {}

  async start(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => void this.beat(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async beat(): Promise<void> {
    try {
      await this.repo.beat(this.workerId);
    } catch (error) {
      this.onError(error);
    }
  }
}
