export const MAX_BUFFERED_EVENTS = 50;

export interface SseWritable {
  write(chunk: string): boolean;
  once(event: 'drain', cb: () => void): void;
  destroy(): void;
  destroyed: boolean;
}

export interface SseStreamOptions {
  onClose: () => void;
}

export class SseStream {
  private closed = false;
  private backedUp = false;
  private pending = 0;

  constructor(
    private readonly raw: SseWritable,
    private readonly opts: SseStreamOptions,
  ) {}

  event(data: string): void {
    this.writeFrame(`data: ${data}\n\n`);
  }

  comment(): void {
    this.writeFrame(':keep-alive\n\n');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.opts.onClose();
  }

  private writeFrame(frame: string): void {
    if (this.closed || this.raw.destroyed) return;

    let flushed: boolean;
    try {
      flushed = this.raw.write(frame);
    } catch {
      this.dropSelf();
      return;
    }
    if (flushed) return;

    this.pending += 1;
    if (this.pending > MAX_BUFFERED_EVENTS) {
      this.dropSelf();
      return;
    }
    if (this.backedUp) return;
    this.backedUp = true;
    this.raw.once('drain', () => {
      this.backedUp = false;
      this.pending = 0;
    });
  }

  private dropSelf(): void {
    if (!this.raw.destroyed) this.raw.destroy();
    this.close();
  }
}
