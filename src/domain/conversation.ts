export interface ConversationKey {
  userPhone: string;
  systemPhone: string;
}

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

function stripInternationalPrefix(trimmed: string): string {
  if (trimmed.startsWith('+')) return trimmed.slice(1);
  if (trimmed.startsWith('00')) return trimmed.slice(2);
  return trimmed;
}

function normalizeE164(raw: string): string {
  const digits = stripInternationalPrefix(raw.trim()).replace(/\D/g, '');
  const normalized = `+${digits}`;
  if (!E164_PATTERN.test(normalized)) {
    throw new Error(`invalid E.164 phone number: ${JSON.stringify(raw)}`);
  }
  return normalized;
}

// Normalizes both phone numbers to E.164 so cosmetically different but
// equivalent representations resolve to the same conversation, backing the
// UNIQUE (user_phone, system_phone) upsert in ingestion.
export function conversationKey(userPhone: string, systemPhone: string): ConversationKey {
  return {
    userPhone: normalizeE164(userPhone),
    systemPhone: normalizeE164(systemPhone),
  };
}
