import { describe, expect, it, vi } from 'vitest';
import { NextFunction, Response } from 'express';
import { csrfProtection, CSRF_COOKIE, CSRF_HEADER } from '../middleware/csrf';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../utils/AppError';

/**
 * Minimal stand-ins for the Express request/response objects. The middleware
 * only reads req.method/path/headers/cookies and a couple of req.get() lookups,
 * so we can unit-test it without booting the app or touching the database.
 */
interface FakeReq {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  cookies: Record<string, string | undefined>;
  get(name: string): string | undefined;
}

function makeReq(overrides: Partial<FakeReq> = {}): FakeReq {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides.headers ?? {})) {
    headers[key.toLowerCase()] = value;
  }
  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/clients',
    headers,
    cookies: overrides.cookies ?? {},
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  };
}

function run(req: Partial<FakeReq> = {}) {
  const next = vi.fn<NextFunction>();
  const res = {} as Response;
  csrfProtection(makeReq(req) as unknown as AuthRequest, res, next);
  const first = next.mock.calls[0]?.[0];
  return { next, error: first as AppError | undefined };
}

describe('csrfProtection (unit)', () => {
  it('lets safe methods (GET/HEAD/OPTIONS) through without a token', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const { error, next } = run({ method, path: '/clients' });
      expect(next).toHaveBeenCalledTimes(1);
      expect(error).toBeUndefined();
    }
  });

  it('rejects a state-changing request with a mismatched Origin (403)', () => {
    const { error } = run({
      method: 'POST',
      headers: { origin: 'https://evil.example', [CSRF_HEADER]: 'good-token' },
      cookies: { [CSRF_COOKIE]: 'good-token' },
    });
    expect(error).toBeInstanceOf(AppError);
    expect(error!.statusCode).toBe(403);
    expect(error!.message).toMatch(/csrf/i);
  });

  it('rejects a POST with a matching Origin but a missing CSRF token', () => {
    const { error } = run({ method: 'POST', headers: { origin: 'http://localhost:5173' }, cookies: { [CSRF_COOKIE]: 'abc' } });
    expect(error).toBeInstanceOf(AppError);
    expect(error!.statusCode).toBe(403);
  });

  it('rejects a POST with a matching Origin but a mismatched CSRF token', () => {
    const { error } = run({
      method: 'POST',
      headers: { origin: 'http://localhost:5173', [CSRF_HEADER]: 'header-token' },
      cookies: { [CSRF_COOKIE]: 'cookie-token' },
    });
    expect(error).toBeInstanceOf(AppError);
    expect(error!.statusCode).toBe(403);
    expect(error!.message).toMatch(/csrf/i);
  });

  it('accepts a POST with a matching Origin AND a matching CSRF token', () => {
    const { error, next } = run({
      method: 'POST',
      headers: { origin: 'http://localhost:5173', [CSRF_HEADER]: 'same-token' },
      cookies: { [CSRF_COOKIE]: 'same-token' },
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(error).toBeUndefined();
  });

  it('lets the three exempt paths through without a token', () => {
    for (const path of ['/auth/login', '/auth/forgot-password', '/auth/reset-password']) {
      const { error, next } = run({ method: 'POST', path });
      expect(next).toHaveBeenCalledTimes(1);
      expect(error).toBeUndefined();
    }
  });

  it('still blocks an exempt path when the Origin is bad', () => {
    for (const path of ['/auth/login', '/auth/forgot-password', '/auth/reset-password']) {
      const { error } = run({ method: 'POST', path, headers: { origin: 'https://evil.example' } });
      expect(error).toBeInstanceOf(AppError);
      expect(error!.statusCode).toBe(403);
    }
  });

  it('rejects a look-alike Origin that merely shares the allowed prefix', () => {
    const { error } = run({
      method: 'POST',
      path: '/auth/login',
      headers: { origin: 'http://localhost:5173.evil.example' },
    });
    expect(error).toBeInstanceOf(AppError);
    expect(error!.statusCode).toBe(403);
  });

  it('rejects the opaque "null" Origin on an exempt path', () => {
    const { error } = run({ method: 'POST', path: '/auth/register', headers: { origin: 'null' } });
    expect(error).toBeInstanceOf(AppError);
    expect(error!.statusCode).toBe(403);
  });

  it('accepts a same-origin Referer that includes a path', () => {
    const { error, next } = run({
      method: 'POST',
      path: '/auth/login',
      headers: { referer: 'http://localhost:5173/register?type=staff' },
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(error).toBeUndefined();
  });

  it('accepts a request carrying an Authorization: Bearer header without a token', () => {
    const { error, next } = run({
      method: 'POST',
      headers: { authorization: 'Bearer some-service-token', origin: 'https://evil.example' },
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(error).toBeUndefined();
  });
});
