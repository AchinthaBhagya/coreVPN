import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../app';
import { createUser, resetDatabase, seedCatalogue, signIn, Api } from './helpers';
import { prisma } from '../config/prisma';
import { sha256 } from '../utils/token';
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

/** Raw `set-cookie` header values from a supertest response. */
function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
}

describe('auth - login & session cookie', () => {
  it('sets an HttpOnly + SameSite=Lax + Path=/ sid cookie on successful login', async () => {
    const user = await createUser({ permissions: ['clients.view'] });
    const res = await new Api(app).login(user.email, user.password);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(user.email);
    // The password hash must never be echoed back to the client.
    expect(res.body.data.user.password).toBeUndefined();

    const sid = setCookies(res).find((cookie) => cookie.startsWith('sid='));
    expect(sid).toBeDefined();
    const lower = sid!.toLowerCase();
    expect(lower).toContain('httponly');
    expect(lower).toContain('samesite=lax');
    expect(lower).toContain('path=/');
  });

  it('rejects a wrong password with 401 and the same generic message', async () => {
    const user = await createUser({ permissions: ['clients.view'] });
    const res = await new Api(app).login(user.email, 'NotTheRight!2026');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('rejects an unknown email with 401 and an identical generic message', async () => {
    const user = await createUser({ permissions: ['clients.view'] });
    const wrongPassword = await new Api(app).login(user.email, 'NotTheRight!2026');
    const unknownEmail = await new Api(app).login('ghost-nobody@test.local', 'NotTheRight!2026');

    expect(unknownEmail.status).toBe(401);
    // Same message + status for unknown email vs wrong password => no enumeration.
    expect(unknownEmail.body.message).toBe('Invalid email or password');
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
  });

  it('rejects a non-ACTIVE account with 403 even when the password is correct', async () => {
    const user = await createUser({ status: 'PENDING' });
    const res = await new Api(app).login(user.email, user.password);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe('auth - /auth/me', () => {
  it('requires a session and returns 401 when unauthenticated', async () => {
    const res = await new Api(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the signed-in user without a password or session token', async () => {
    const user = await createUser({ permissions: ['clients.view'] });
    const api = await signIn(app, user);
    const res = await api.get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.user.password).toBeUndefined();
    expect(res.body.data.user.token).toBeUndefined();
  });
});

describe('auth - logout', () => {
  it('revokes the session server-side (the Session row is deleted)', async () => {
    const user = await createUser({ permissions: ['clients.view'] });
    const api = await signIn(app, user);
    expect((await api.get('/auth/me')).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);

    const logout = await api.post('/auth/logout');
    expect(logout.status).toBe(200);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await api.get('/auth/me')).status).toBe(401);
  });
});

describe('auth - PATCH /auth/profile', () => {
  it('updates only the current user', async () => {
    const me = await createUser({ permissions: ['clients.view'] });
    const other = await createUser({ permissions: ['clients.view'] });
    const api = await signIn(app, me);

    const res = await api.patch('/auth/profile', { firstName: 'Renamed', lastName: 'Person' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.firstName).toBe('Renamed');
    expect(res.body.data.user.lastName).toBe('Person');

    const reloadedMe = await prisma.user.findUnique({ where: { id: me.id } });
    const reloadedOther = await prisma.user.findUnique({ where: { id: other.id } });
    expect(reloadedMe!.firstName).toBe('Renamed');
    // The other account is untouched.
    expect(reloadedOther!.firstName).toBe('Test');
    expect(reloadedOther!.lastName).toBe('User');
  });
});

describe('auth - POST /auth/change-password', () => {
  it('rejects a weak new password with 422', async () => {
    const user = await createUser({});
    const api = await signIn(app, user);
    const res = await api.post('/auth/change-password', { currentPassword: user.password, newPassword: 'weak' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/password/i);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('rejects a wrong current password with 400', async () => {
    const user = await createUser({});
    const api = await signIn(app, user);
    const res = await api.post('/auth/change-password', {
      currentPassword: 'TotallyWrong!2026',
      newPassword: 'BrandNewPass!2026',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Your current password is incorrect');
  });

  it('refuses to reuse the current password', async () => {
    const user = await createUser({});
    const api = await signIn(app, user);
    const res = await api.post('/auth/change-password', {
      currentPassword: user.password,
      newPassword: user.password,
    });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/different from the current password/i);
  });

  it('revokes other sessions while keeping the returned session alive', async () => {
    const user = await createUser({});
    const api1 = await signIn(app, user);
    const api2 = await signIn(app, user);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);

    const res = await api1.post('/auth/change-password', {
      currentPassword: user.password,
      newPassword: 'BrandNewPass!2026z',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.changed).toBe(true);

    // Only the freshly issued session survives.
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    // The other browser is signed out.
    expect((await api2.get('/auth/me')).status).toBe(401);
    // The session that changed the password still works.
    const me = await api1.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(user.email);

    // The new password is now usable.
    const relogin = await new Api(app).login(user.email, 'BrandNewPass!2026z');
    expect(relogin.status).toBe(200);
  });
});

describe('auth - password reset flow', () => {
  it('returns the same generic message for known and unknown emails', async () => {
    const user = await createUser({});
    const before = await prisma.passwordResetToken.count({ where: { userId: user.id } });

    const known = await new Api(app).post('/auth/forgot-password', { email: user.email });
    const unknown = await new Api(app).post('/auth/forgot-password', { email: 'nobody-here@test.local' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe('If that email address is registered, a reset link has been sent.');
    expect(unknown.body.message).toBe(known.body.message);

    // A token row is created for the known user only.
    const after = await prisma.passwordResetToken.count({ where: { userId: user.id } });
    expect(after).toBe(before + 1);
  });

  it('resets once, marks the token used, rejects reuse/expiry, and revokes all sessions', async () => {
    const user = await createUser({});
    await signIn(app, user);
    await signIn(app, user);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);

    // We cannot read the emailed token, so insert one directly (hash-only storage).
    const rawToken = 'reset'.repeat(16);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(rawToken), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const res = await new Api(app).post('/auth/reset-password', { token: rawToken, newPassword: 'ResetPass!2026x' });
    expect(res.status).toBe(200);
    expect(res.body.data.reset).toBe(true);

    // Token is consumed.
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    expect(record!.usedAt).not.toBeNull();
    // Every session for that user is revoked.
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

    // Reusing the token fails.
    const second = await new Api(app).post('/auth/reset-password', { token: rawToken, newPassword: 'SecondPass!2026y' });
    expect(second.status).toBe(400);

    // The reset password now signs in.
    const relogin = await new Api(app).login(user.email, 'ResetPass!2026x');
    expect(relogin.status).toBe(200);
  });

  it('rejects an expired reset token', async () => {
    const user = await createUser({});
    const rawToken = 'expired'.repeat(16);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(rawToken), expiresAt: new Date(Date.now() - 60 * 1000) },
    });

    const res = await new Api(app).post('/auth/reset-password', { token: rawToken, newPassword: 'ResetPass!2026x' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('auth - password policy', () => {
  it('enforces length, case, digit and symbol requirements', () => {
    const weak = validatePasswordPolicy('password');
    expect(weak.valid).toBe(false);
    expect(weak.errors.length).toBeGreaterThanOrEqual(4);

    expect(validatePasswordPolicy('Nodigit!Only').valid).toBe(false); // no digit
    expect(validatePasswordPolicy('Nodigit11Only').valid).toBe(false); // no symbol
    expect(validatePasswordPolicy('alllowercase12!').valid).toBe(false); // no uppercase
    expect(validatePasswordPolicy('ALLUPPERCASE12!').valid).toBe(false); // no lowercase
    expect(validatePasswordPolicy('Str0ng!Pass').valid).toBe(true);
  });
});
