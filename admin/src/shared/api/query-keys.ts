export const queryKeys = {
  config: ['config'] as const,
  conversations: (cursor: string | null) => ['conversations', { cursor }] as const,
  conversationList: ['conversations'] as const,
  conversationDetail: (id: string) => ['conversation', id, 'messages'] as const,
};
