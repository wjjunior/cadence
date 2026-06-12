// Shared NOTIFY channel names so the emitter and the LISTEN side cannot drift apart.
export const notifyChannels = {
  jobCreated: 'job_created',
  conversationChanged: 'conversation_changed',
} as const;
