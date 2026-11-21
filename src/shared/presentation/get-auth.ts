import type { Request } from 'express';
import { invalidSession } from '../domain/errors';

export function getAuth(request: Request) {
  if (!request.auth) throw invalidSession();
  return request.auth;
}
