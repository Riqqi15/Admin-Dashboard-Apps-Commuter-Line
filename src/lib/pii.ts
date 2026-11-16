import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encryptPii(value: string, key: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptPii(value: string, key: string, context: string) {
  if (!/^v1\.[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid encrypted field');
  const envelope = Buffer.from(value.slice(3), 'base64');
  if (envelope.length < 29) throw new Error('Invalid encrypted field');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), envelope.subarray(0, 12));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(envelope.subarray(12, 28));
  return Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()]).toString('utf8');
}
