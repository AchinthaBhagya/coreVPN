import { Response, Request } from 'express';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { generateOpaqueToken, sha256 } from '../utils/token';
import { CSRF_COOKIE } from '../middleware/csrf';

export const SESSION_COOKIE = 'sid';

export interface CreatedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

/**
 * Creates a new server-side session. The raw token is only ever returned to the
 * caller so it can be placed in an HTTP-only cookie; only its SHA-256 hash is
 * persisted. A separate, non-HTTP-only CSRF token is issued for double-submit
 * protection.
 */
export async function createSession(
  userId: string,
  req: Request,
  ttlHours: number = env.sessionTtlHours,
): Promise<CreatedSession> {
  const token = generateOpaqueToken(32);
  const csrfToken = generateOpaqueToken(16);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      userId,
      token: sha256(token),
      expiresAt,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    },
  });

  return { token, csrfToken, expiresAt };
}

export async function destroySessionByRawToken(rawToken: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token: sha256(rawToken) } });
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

export function setAuthCookies(res: Response, session: CreatedSession): void {
  const maxAge = Math.max(0, session.expiresAt.getTime() - Date.now());
  res.cookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge,
  });
  // Readable by the SPA so it can echo the token back in the X-CSRF-Token header.
  res.cookie(CSRF_COOKIE, session.csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge,
  });
}

export function setCsrfCookie(res: Response, csrfToken: string): void {
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: env.sessionTtlHours * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}
