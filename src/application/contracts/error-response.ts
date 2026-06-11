import { z } from 'zod';

export const ErrorResponse = z.object({ error: z.string() });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export function errorResponse(message: string): ErrorResponse {
  return { error: message };
}
