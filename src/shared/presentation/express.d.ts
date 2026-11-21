import type { AuthContext } from '../domain/roles';

declare global {
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}

export {};
