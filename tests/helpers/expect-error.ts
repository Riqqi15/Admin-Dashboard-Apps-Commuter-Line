import { expect } from 'vitest';

// Asserts the stable error envelope, not just the HTTP status: clients branch on error.code.
export function expectError(response: { status: number; body: { success?: boolean; error?: { code?: string } } }, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.body.success).toBe(false);
  expect(response.body.error?.code).toBe(code);
}
