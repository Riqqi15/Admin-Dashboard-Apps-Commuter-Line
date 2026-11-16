import { describe, expect, it } from 'vitest';
import { decryptPii, encryptPii } from '../../src/lib/pii';

describe('Versioned authenticated PII encryption', () => {
  it('uses independent random IVs and binds ciphertext to record and field', () => {
    const key = 'a'.repeat(64);
    const first = encryptPii('Passenger fixture', key, 'user:1:name');
    const second = encryptPii('Passenger fixture', key, 'user:1:name');
    expect(first).not.toBe(second);
    expect(first).toMatch(/^v1\./);
    expect(decryptPii(first, key, 'user:1:name')).toBe('Passenger fixture');
    expect(() => decryptPii(first, 'b'.repeat(64), 'user:1:name')).toThrow();
    expect(() => decryptPii(first, key, 'user:2:name')).toThrow();
    const buffer = Buffer.from(first.slice(3), 'base64');
    buffer[15] = buffer[15]! ^ 1;
    expect(() => decryptPii('v1.' + buffer.toString('base64'), key, 'user:1:name')).toThrow();
    expect(() => decryptPii('v2.invalid', key, 'user:1:name')).toThrow();
  });
});
