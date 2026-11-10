import type { Request, RequestHandler } from 'express';
import type { Env } from '../config/env';
import type { PrismaClient } from '../generated/prisma/client';
import { invalidSession, tokenHash } from '../features/auth/auth.service';

export function getAuth(request: Request) {
  if (!request.auth) throw invalidSession();
  return request.auth;
}

export function requireSession(db: PrismaClient, config: Env): RequestHandler {
  return async (request, _response, next) => {
    const cookieCount = (request.headers.cookie || '').split(';').filter(part => part.trim().startsWith('admin_session=')).length;
    const token: unknown = request.cookies?.admin_session;
    if (cookieCount !== 1 || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalidSession();
    const session = await db.adminSession.findUnique({ where: { tokenHash: tokenHash(config, 'session', token) }, include: { adminUser: { include: { station: true } } } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw invalidSession();
    const user = session.adminUser;
    if (!user.isActive || (user.role === 'STATION_SECURITY' && !user.station?.isActive)) {
      await db.adminSession.updateMany({ where: { adminUserId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      throw invalidSession();
    }
    request.auth = Object.freeze({ sessionId: session.id, userId: user.id, username: user.username, role: user.role, stationId: user.stationId, mustChangePassword: user.mustChangePassword, csrfTokenHash: session.csrfTokenHash, expiresAt: session.expiresAt });
    next();
  };
}
