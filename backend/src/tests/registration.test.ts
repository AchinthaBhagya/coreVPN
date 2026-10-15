import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../app';
import { Api, ORIGIN, resetDatabase, seedCatalogue } from './helpers';
import { prisma } from '../config/prisma';
import { sha256 } from '../utils/token';

let app: Express;

beforeAll(async () => {
  app = createApp();
  await resetDatabase();
  await seedCatalogue();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const validPassword = 'Str0ng!Pass123';

describe('registration - team member (STAFF)', () => {
  it('creates a PENDING account with no roles and requires owner approval', async () => {
    const email = 'new.staff@test.local';
    const res = await new Api(app).post('/auth/register', {
      accountType: 'STAFF',
      firstName: 'New',
      lastName: 'Staff',
      email,
      password: validPassword,
      phone: '+94770000000',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      accountType: 'STAFF',
      status: 'PENDING',
      emailVerified: false,
    });

    const user = await prisma.user.findUnique({ where: { email }, include: { userRoles: true } });
    expect(user).not.toBeNull();
    expect(user!.status).toBe('PENDING');
    expect(user!.emailVerifiedAt).toBeNull();
    // No role is granted until an owner approves and assigns one.
    expect(user!.userRoles).toHaveLength(0);
    // No client record, no verification token (owner approval is the gate).
    expect(await prisma.client.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.emailVerificationToken.count({ where: { userId: user!.id } })).toBe(0);

    // Cannot sign in until approved.
    expect((await new Api(app).login(email, validPassword)).status).toBe(403);
  });
});

describe('registration - customer (CLIENT)', () => {
  it('creates a client record, assigns the Client role and issues a verification token', async () => {
    const email = 'new.customer@test.local';
    const res = await new Api(app).post('/auth/register', {
      accountType: 'CLIENT',
      firstName: 'New',
      lastName: 'Customer',
      email,
      password: validPassword,
      companyName: 'Customer Co',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ accountType: 'CLIENT', status: 'PENDING', emailVerified: false });

    const user = await prisma.user.findUnique({
      where: { email },
      include: { userRoles: { include: { role: true } }, client: true },
    });
    expect(user!.status).toBe('PENDING');
    expect(user!.emailVerifiedAt).toBeNull();
    expect(user!.userRoles.map((ur) => ur.role.name)).toContain('Client');
    expect(user!.client).not.toBeNull();
    expect(user!.client!.companyName).toBe('Customer Co');
    expect(user!.client!.type).toBe('BUSINESS');

    // A single-use verification token exists (hash only).
    const tokens = await prisma.emailVerificationToken.findMany({ where: { userId: user!.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].usedAt).toBeNull();

    // Still cannot sign in before verifying.
    expect((await new Api(app).login(email, validPassword)).status).toBe(403);
  });
});

describe('registration - validation & abuse', () => {
  it('rejects a duplicate email with 409 regardless of account type', async () => {
    const email = 'dupe@test.local';
    const first = await new Api(app).post('/auth/register', {
      accountType: 'STAFF',
      firstName: 'A',
      lastName: 'B',
      email,
      password: validPassword,
    });
    expect(first.status).toBe(201);

    const second = await new Api(app).post('/auth/register', {
      accountType: 'CLIENT',
      firstName: 'A',
      lastName: 'B',
      email,
      password: validPassword,
    });
    expect(second.status).toBe(409);
  });

  it('enforces the password policy and required fields', async () => {
    const weak = await new Api(app).post('/auth/register', {
      accountType: 'STAFF',
      firstName: 'A',
      lastName: 'B',
      email: 'weak@test.local',
      password: 'weak',
    });
    expect(weak.status).toBe(422);

    const missingType = await new Api(app).post('/auth/register', {
      firstName: 'A',
      lastName: 'B',
      email: 'notype@test.local',
      password: validPassword,
    });
    expect(missingType.status).toBe(422);
  });

  it('allows registration without a CSRF token but still enforces the origin allow-list', async () => {
    const ok = await request(app)
      .post('/api/auth/register')
      .set('Origin', ORIGIN)
      .send({
        accountType: 'STAFF',
        firstName: 'No',
        lastName: 'Csrf',
        email: 'no.csrf@test.local',
        password: validPassword,
      });
    expect(ok.status).toBe(201);

    const blocked = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'https://evil.example.com')
      .send({
        accountType: 'STAFF',
        firstName: 'No',
        lastName: 'Csrf',
        email: 'evil.csrf@test.local',
        password: validPassword,
      });
    expect(blocked.status).toBe(403);
  });
});

describe('email verification', () => {
  it('activates a customer account once the token is verified, then rejects reuse', async () => {
    const email = 'verify.me@test.local';
    await new Api(app).post('/auth/register', {
      accountType: 'CLIENT',
      firstName: 'V',
      lastName: 'Me',
      email,
      password: validPassword,
    });
    const user = await prisma.user.findUnique({ where: { email } });
    const tokens = await prisma.emailVerificationToken.findMany({ where: { userId: user!.id } });
    expect(tokens).toHaveLength(1);

    // We cannot read the emailed raw token, so swap in one we know (hash-only storage).
    const rawToken = 'verify'.repeat(20);
    await prisma.emailVerificationToken.update({ where: { id: tokens[0].id }, data: { tokenHash: sha256(rawToken) } });

    const res = await new Api(app).post('/auth/verify-email', { token: rawToken });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ verified: true, activated: true });

    const reloaded = await prisma.user.findUnique({ where: { email } });
    expect(reloaded!.status).toBe('ACTIVE');
    expect(reloaded!.emailVerifiedAt).not.toBeNull();

    // Token is consumed and cannot be reused.
    expect((await new Api(app).post('/auth/verify-email', { token: rawToken })).status).toBe(400);

    // The account can now sign in.
    expect((await new Api(app).login(email, validPassword)).status).toBe(200);
  });

  it('rejects expired and unknown verification tokens', async () => {
    const email = 'expired.verify@test.local';
    await new Api(app).post('/auth/register', {
      accountType: 'CLIENT',
      firstName: 'E',
      lastName: 'V',
      email,
      password: validPassword,
    });
    const user = await prisma.user.findUnique({ where: { email } });
    const rawToken = 'expired2'.repeat(10);
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user!.id },
      data: { tokenHash: sha256(rawToken), expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await new Api(app).post('/auth/verify-email', { token: rawToken })).status).toBe(400);
    expect((await new Api(app).post('/auth/verify-email', { token: 'a'.repeat(40) })).status).toBe(400);
  });

  it('resends verification with a generic response and issues no token for unknown emails', async () => {
    const email = 'resend.me@test.local';
    await new Api(app).post('/auth/register', {
      accountType: 'CLIENT',
      firstName: 'R',
      lastName: 'M',
      email,
      password: validPassword,
    });
    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.emailVerificationToken.deleteMany({ where: { userId: user!.id } });

    const known = await new Api(app).post('/auth/resend-verification', { email });
    const unknown = await new Api(app).post('/auth/resend-verification', { email: 'ghost@test.local' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    // Identical responses so the endpoint cannot enumerate accounts.
    expect(known.body.message).toBe(unknown.body.message);

    // A fresh token exists for the real (unverified) user only.
    expect(await prisma.emailVerificationToken.count({ where: { userId: user!.id } })).toBe(1);
  });
});

describe('sign-in providers', () => {
  it('reports Google as disabled when no credentials are configured', async () => {
    const res = await new Api(app).get('/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body.data.google).toBe(false);
  });

  it('returns 503 from /auth/google when Google is not configured', async () => {
    const res = await new Api(app).get('/auth/google');
    expect(res.status).toBe(503);
  });
});
