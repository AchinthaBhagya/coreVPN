import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../app';
import { resetDatabase, seedCatalogue, createUser, signIn, ORIGIN, Api } from './helpers';
import { prisma } from '../config/prisma';
import { validatePasswordPolicy } from '../utils/password';

let app: Express;

beforeAll(async () => {
  app = createApp();
  await resetDatabase();
  await seedCatalogue();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('harness sanity', () => {
  it('rejects a write with a mismatched Origin', async () => {
    const api = new Api(app);
    const res = await api.login('nobody@test.local', 'Whatever!2026', { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('rejects a state-changing request without the CSRF token', async () => {
    const api = new Api(app);
    // /auth/logout is not CSRF-exempt (only login/forgot/reset are).
    const res = await api.post('/auth/logout', undefined, { csrf: false });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/csrf/i);
  });

  it('never accepts a login for an unknown account (and stays enumeratable-safe)', async () => {
    const api = new Api(app);
    const res = await api.login('nobody@test.local', 'Whatever!2026');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('rejects weak passwords against the policy', () => {
    const result = validatePasswordPolicy('password');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    expect(validatePasswordPolicy('OwnerDev#2026x').valid).toBe(true);
  });

  it('requires authentication for protected endpoints', async () => {
    const res = await new Api(app).get('/clients');
    expect(res.status).toBe(401);
  });

  it('signs in, exposes the session over an HttpOnly cookie, and returns the auth user', async () => {
    const user = await createUser({ permissions: ['clients.view'] });
    const res = await new Api(app).login(user.email, user.password);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);

    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    const sid = (setCookie ?? []).find((cookie) => cookie.startsWith('sid='));
    expect(sid).toBeDefined();
    expect(sid!.toLowerCase()).toContain('httponly');

    const api = await signIn(app, user);
    const me = await api.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(user.email);
    expect(me.body.data.user.password).toBeUndefined();
    expect(ORIGIN).toBe('http://localhost:5173');
  });

  it('revokes the session on logout', async () => {
    const user = await createUser({ permissions: ['clients.view'] });
    const api = await signIn(app, user);
    expect((await api.get('/auth/me')).status).toBe(200);

    const logout = await api.post('/auth/logout');
    expect(logout.status).toBe(200);
    expect((await api.get('/auth/me')).status).toBe(401);
  });
});
