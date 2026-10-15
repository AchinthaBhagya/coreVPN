import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Endpoints that run before a session (and therefore a CSRF cookie) exists.
 * They still pass the Origin/Referer allow-list check below, which is the
 * meaningful CSRF defence for login and password-reset requests.
 */
const EXEMPT_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/verify-email',
  '/auth/resend-verification',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

/**
 * Defence-in-depth CSRF protection for cookie-based sessions:
 *  1. SameSite=Lax cookies (set in auth controller)
 *  2. Origin/Referer allow-list check for state-changing requests
 *  3. Double-submit CSRF token comparison
 * Requests carrying a Bearer token (non-browser clients) skip the check.
 */
export function csrfProtection(req: AuthRequest, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const hasBearer = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ');
  if (hasBearer) return next();

  const origin = req.get('origin') ?? req.get('referer');
  if (origin) {
    const allowed = env.corsOrigin.some((allowedOrigin) => origin.startsWith(allowedOrigin));
    if (!allowed) return next(new AppError('Request blocked by CSRF origin policy', 403));
  }

  const path = (req.path || '/').replace(/\/+$/, '') || '/';
  if (EXEMPT_PATHS.has(path)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(new AppError('Invalid or missing CSRF token', 403));
  }

  return next();
}
