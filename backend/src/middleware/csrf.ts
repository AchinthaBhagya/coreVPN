import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Normalises an Origin/Referer value or a configured allow-list entry to a
 * comparable `scheme://host:port` string. Parsing (rather than string
 * prefixing) is what stops look-alike hosts such as
 * `https://app.example.com.evil.com` from passing the allow-list. Values that
 * are not absolute URLs (including the literal `null` a sandboxed iframe
 * sends) fall back to a trimmed, slash-stripped string so they can still be
 * rejected by comparison.
 */
function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.trim().replace(/\/+$/, '');
  }
}

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
    const normalized = normalizeOrigin(origin);
    const allowed = env.corsOrigin.some((allowedOrigin) => normalizeOrigin(allowedOrigin) === normalized);
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
