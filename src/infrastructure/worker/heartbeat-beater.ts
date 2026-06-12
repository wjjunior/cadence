import type { HeartbeatRepository } from '../../application/ports/heartbeat-repository.js';

const noop = (): void => {};

export class HeartbeatBeater {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly repo: HeartbeatRepository,
    private readonly workerId: string,
    private readonly intervalMs: number,
    private readonly onError: (error: unknown) => void = noop,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.beat();
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // Self-rescheduling so a beat that outlasts the interval can never overlap the next (setInterval would).
  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.beat().finally(() => this.scheduleNext());
    }, this.intervalMs);
  }

  private async beat(): Promise<void> {
    try {
      await this.repo.beat(this.workerId);
    } catch (error) {
      this.onError(error);
    }
  }
}
