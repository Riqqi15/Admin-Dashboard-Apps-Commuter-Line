import type { RequestHandler } from 'express';
import { invalidSession } from '../../../shared/domain/errors';
import type { AuthUseCases } from '../application/auth-use-cases';

// Exactly one well-formed session cookie is accepted; the use case decides whether it is still valid.
export function requireSession(useCases: Pick<AuthUseCases, 'authenticate'>): RequestHandler {
  return async (request, _response, next) => {
    const cookieCount = (request.headers.cookie || '').split(';').filter(part => part.trim().startsWith('admin_session=')).length;
    const token: unknown = request.cookies?.admin_session;
    if (cookieCount !== 1 || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalidSession();
    request.auth = await useCases.authenticate(token);
    next();
  };
}
