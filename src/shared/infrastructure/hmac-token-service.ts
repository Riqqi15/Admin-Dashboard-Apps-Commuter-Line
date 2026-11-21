import { createHmac, randomBytes } from 'node:crypto';
import type { TokenService } from '../application/token-service';

// Only the HMAC is stored; the pepper and the purpose prefix keep session and CSRF hashes in separate domains.
export const hmacTokenService = (pepper: string): TokenService => ({
  generate: () => randomBytes(32).toString('hex'),
  hash: (purpose, token) => createHmac('sha256', pepper).update(purpose + ':' + token).digest('hex'),
});
