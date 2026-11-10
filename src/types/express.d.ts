import type { AuthContext } from '../features/auth/auth.service';

declare global {
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}

export {};
