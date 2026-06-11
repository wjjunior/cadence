import type { WorkerQueue } from '../../application/ports/job-queue.js';
import type { Job } from '../../domain/job.js';
import type { DbClient } from '../db/client.js';
import { notifyChannels } from '../db/notify-channels.js';

export interface WorkerRuntimeDeps {
  queue: WorkerQueue;
  sql: DbClient['sql'];
  processJob: (job: Job) => Promise<void>;
  concurrency: number;
  reconcilePollMs: number;
  workerId: string;
  onError?: (error: unknown, job: Job | null) => void;
}

const noop = (): void => {};

export class WorkerRuntime {
  private readonly onError: (error: unknown, job: Job | null) => void;
  private stopped = false;
  private runners: Promise<void>[] = [];
  private waiters: Array<() => void> = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listener: { unlisten: () => Promise<void> } | null = null;

  constructor(private readonly deps: WorkerRuntimeDeps) {
    this.onError = deps.onError ?? noop;
  }

  async start(): Promise<void> {
    this.stopped = false;
    // onNotify wakes for latency; onListen wakes on every (re)connect — the
    // reconciliation sweep that closes the NOTIFY-lost-while-disconnected gap.
    this.listener = await this.deps.sql.listen(
      notifyChannels.jobCreated,
      () => this.wake(),
      () => this.wake(),
    );
    this.pollTimer = setInterval(() => void this.reconcile(), this.deps.reconcilePollMs);
    for (let i = 0; i < this.deps.concurrency; i++) {
      this.runners.push(this.runLoop(`${this.deps.workerId}-${i}`));
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.listener) {
      await this.listener.unlisten();
      this.listener = null;
    }
    this.wake();
    await Promise.all(this.runners);
    this.runners = [];
  }

  // The reconciliation poll tick: reclaim abandoned leases, then wake runners to
  // re-sweep — the durability backstop for any NOTIFY that was lost.
  private async reconcile(): Promise<void> {
    try {
      await this.deps.queue.reapExpiredLeases();
    } catch (error) {
      this.onError(error, null);
    }
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  private waitForWake(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private async runLoop(slotId: string): Promise<void> {
    while (!this.stopped) {
      let job: Job | null = null;
      try {
        job = await this.deps.queue.claim(slotId);
      } catch (error) {
        this.onError(error, null);
      }
      if (this.stopped) break;
      if (job) {
        try {
          await this.deps.processJob(job);
        } catch (error) {
          this.onError(error, job);
        }
        continue;
      }
      await this.waitForWake();
    }
  }
}
