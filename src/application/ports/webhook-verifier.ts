export interface WebhookVerifier {
  verify(input: { signature: string | undefined; url: string; params: Record<string, string> }): boolean;
}
