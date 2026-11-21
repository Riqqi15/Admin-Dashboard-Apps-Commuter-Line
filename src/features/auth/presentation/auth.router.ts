import { Router } from 'express';
import type { CookieOptions } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { Env } from '../../../config/env';
import type { TokenService } from '../../../shared/application/token-service';
import { AppError } from '../../../shared/domain/errors';
import { getAuth } from '../../../shared/presentation/get-auth';
import type { Guards } from '../../../shared/presentation/guards';
import type { AuthUseCases } from '../application/auth-use-cases';
import { changePasswordSchema, loginSchema } from './auth.schema';

const cookieOptions = (config: Env): CookieOptions => ({ httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict', path: '/api/v1' });

export function authRouter(useCases: AuthUseCases, guards: Guards, tokens: TokenService, config: Env) {
  const router = Router();
  const limited = { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts; try again later' } };
  const limits = { windowMs: 15 * 60 * 1000, standardHeaders: 'draft-8' as const, legacyHeaders: false, message: limited, validate: { xForwardedForHeader: false } };
  const perIp = rateLimit({ ...limits, limit: 30 });
  const perUser = rateLimit({ ...limits, limit: 5, skipSuccessfulRequests: true, keyGenerator: request => {
    const username: unknown = request.body?.username;
    const normalized = typeof username === 'string' ? username.trim().toLowerCase().slice(0, 50) : '';
    return ipKeyGenerator(request.ip || request.socket.remoteAddress || '127.0.0.1') + ':' + tokens.hash('session', normalized);
  } });
  router.post('/login', perIp, (request, _response, next) => {
    if (!request.is('application/json')) throw new AppError(415, 'JSON_REQUIRED', 'Content-Type must be application/json');
    if (request.get('Sec-Fetch-Site') === 'cross-site') throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed');
    loginSchema.parse(request.body);
    next();
  }, perUser, async (request, response) => {
    const input = loginSchema.parse(request.body);
    const result = await useCases.login(input.username, input.password);
    response.cookie('admin_session', result.token, { ...cookieOptions(config), expires: result.expiresAt });
    response.json({ success: true, data: { user: result.user, csrfToken: result.csrfToken } });
  });
  router.use(guards.session, guards.csrf);
  router.get('/me', (request, response) => {
    const auth = getAuth(request);
    response.json({ success: true, data: { id: auth.userId, username: auth.username, role: auth.role, stationId: auth.stationId, mustChangePassword: auth.mustChangePassword } });
  });
  router.post('/logout', async (request, response) => {
    await useCases.logout(getAuth(request));
    response.clearCookie('admin_session', cookieOptions(config));
    response.json({ success: true, data: { loggedOut: true } });
  });
  const passwordLimit = rateLimit({ ...limits, limit: 5, skipSuccessfulRequests: true, keyGenerator: request => getAuth(request).userId + ':' + ipKeyGenerator(request.ip || '127.0.0.1') });
  router.post('/change-password', passwordLimit, async (request, response) => {
    const input = changePasswordSchema.parse(request.body);
    const result = await useCases.changePassword(getAuth(request), input.currentPassword, input.newPassword);
    response.cookie('admin_session', result.token, { ...cookieOptions(config), expires: result.expiresAt });
    response.json({ success: true, data: { user: result.user, csrfToken: result.csrfToken } });
  });
  return router;
}
