import type { Message } from '../../domain/message.js';

export interface ReplyGenerator {
  generate(ctx: {
    conversationId: string;
    inboundBody: string;
    history: Message[];
  }): Promise<{ body: string }>;
}
