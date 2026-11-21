import { argon2id, hash, verify } from 'argon2';
import type { PasswordHasher } from '../application/password-hasher';

export const hashPassword = (password: string) => hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });

export const argon2PasswordHasher: PasswordHasher = {
  hash: hashPassword,
  verify: (passwordHash, password) => verify(passwordHash, password),
};
