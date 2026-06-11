import type { ReplyGenerator } from '../../application/ports/reply-generator.js';

interface SimulatedReplyGeneratorDeps {
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SimulatedReplyGenerator implements ReplyGenerator {
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: { minMs: number; maxMs: number }, deps: SimulatedReplyGeneratorDeps = {}) {
    this.minMs = opts.minMs;
    this.maxMs = opts.maxMs;
    this.random = deps.random ?? Math.random;
    this.sleep = deps.sleep ?? realSleep;
  }

  async generate(ctx: Parameters<ReplyGenerator['generate']>[0]): Promise<{ body: string }> {
    const delayMs = this.minMs + Math.round(this.random() * (this.maxMs - this.minMs));
    await this.sleep(delayMs);
    return {
      body: `Thanks for your message: "${ctx.inboundBody.trim()}". An agent will follow up shortly.`,
    };
  }
}
