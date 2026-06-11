export interface ConversationChangedEvent {
  conversationId: string;
}

export type Unsubscribe = () => void;

export interface EventBus {
  subscribe(listener: (event: ConversationChangedEvent) => void): Unsubscribe;
}
