export const queryKeys = {
  config: ['config'] as const,
  conversationList: ['conversations'] as const,
  conversationDetail: (id: string) => ['conversation', id, 'messages'] as const,
};
