const UNIQUE_VIOLATION = '23505';
const ONE_RUNNING_PER_CONVERSATION = 'one_running_per_conversation';

export function isBenignContention(error: unknown): boolean {
  const e = error as { code?: string; constraint_name?: string };
  return e.code === UNIQUE_VIOLATION && e.constraint_name === ONE_RUNNING_PER_CONVERSATION;
}
