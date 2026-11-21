export type TokenPurpose = 'session' | 'csrf';

export interface TokenService {
  generate(): string;
  hash(purpose: TokenPurpose, token: string): string;
}
