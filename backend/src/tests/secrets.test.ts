import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../app';
import {
  Api,
  createUser,
  listOf,
  resetDatabase,
  seedCatalogue,
  signIn,
  signInWithPermissions,
} from './helpers';
import { prisma } from '../config/prisma';
import type { TestUser } from './helpers';

let app: Express;

const WEBHOOK_ID = '1234567890';
const WEBHOOK_TOKEN = 'verySecretToken';
const WEBHOOK_URL = `https://discord.com/api/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`;
const EVENT = 'invoice.issued';

let admin: TestUser;
let adminApi: Api;

beforeAll(async () => {
  app = createApp();
  await resetDatabase();
  await seedCatalogue();

  admin = await createUser({ permissions: ['settings.integrations', 'settings.view', 'users.view'] });
  adminApi = await signIn(app, admin);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('integrations - Discord webhook secrets never leave the server', () => {
  it('does not echo the raw webhook URL or token on update', async () => {
    const res = await adminApi.put('/integrations/discord', { event: EVENT, url: WEBHOOK_URL });
    expect(res.status).toBe(200);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(WEBHOOK_URL);
    expect(raw).not.toContain(WEBHOOK_TOKEN);
    expect(raw).not.toContain(WEBHOOK_ID);

    expect(res.body.data.maskedUrl).toMatch(/^https:\/\/discord(\.com|app\.com)\/api\/webhooks\//);
    expect(res.body.data.maskedUrl).toContain('****');
    expect(typeof res.body.data.isEnabled).toBe('boolean');
  });

  it('does not leak the secret on the dedicated list endpoint', async () => {
    const res = await adminApi.get('/integrations/discord');
    expect(res.status).toBe(200);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(WEBHOOK_URL);
    expect(raw).not.toContain(WEBHOOK_TOKEN);
    expect(raw).not.toContain(WEBHOOK_ID);

    const row = (res.body.data.events as Array<{ event: string; hasWebhook: boolean; maskedUrl: string | null }>).find(
      (r) => r.event === EVENT,
    );
    expect(row).toBeDefined();
    expect(row!.hasWebhook).toBe(true);
    expect(row!.maskedUrl).toContain('****');
    expect(row!.maskedUrl).not.toContain(WEBHOOK_TOKEN);
  });

  it('omits secret values from the generic integration listing (configured-style flag instead)', async () => {
    const res = await adminApi.get('/integrations');
    expect(res.status).toBe(200);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(WEBHOOK_URL);
    expect(raw).not.toContain(WEBHOOK_TOKEN);
    expect(raw).not.toContain(WEBHOOK_ID);

    const rows = listOf<{ key: string; value: string | null; isSecret: boolean; isEnabled: boolean }>(res);
    const secretRow = rows.find((r) => r.key === `webhook.${EVENT}`);
    expect(secretRow).toBeDefined();
    expect(secretRow!.isSecret).toBe(true);
    expect(secretRow!.value).toBeNull();
    expect(typeof secretRow!.isEnabled).toBe('boolean');
  });

  it('stores the real URL server-side but refuses to accept the masked value back', async () => {
    // The real URL is persisted so the worker can deliver webhooks...
    const stored = await prisma.integrationSetting.findUnique({
      where: { provider_key: { provider: 'DISCORD', key: `webhook.${EVENT}` } },
    });
    expect(stored!.value).toBe(WEBHOOK_URL);
    expect(stored!.isSecret).toBe(true);

    // ...but the masked form cannot be replayed to recover / overwrite it.
    const res = await adminApi.put('/integrations/discord', { event: EVENT, url: `https://discord.com/api/webhooks/${WEBHOOK_ID}****` });
    expect(res.status).toBe(422);

    const after = await prisma.integrationSetting.findUnique({
      where: { provider_key: { provider: 'DISCORD', key: `webhook.${EVENT}` } },
    });
    expect(after!.value).toBe(WEBHOOK_URL);
  });

  it('denies a user without the integrations permission', async () => {
    const viewer = await createUser({ permissions: ['settings.view'] });
    const api = await signIn(app, viewer);

    const discord = await api.get('/integrations/discord');
    expect(discord.status).toBe(403);

    const list = await api.get('/integrations');
    expect(list.status).toBe(403);
  });
});

describe('settings - no Discord secret is exposed through /settings/system', () => {
  it('returns runtime config without any webhook secret', async () => {
    const res = await adminApi.get('/settings/system');
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(WEBHOOK_URL);
    expect(raw).not.toContain(WEBHOOK_TOKEN);
    expect(raw).not.toContain(WEBHOOK_ID);
  });
});

describe('serializers - sensitive fields are stripped', () => {
  it('never includes a user password in the users listing or detail', async () => {
    const { api } = await signInWithPermissions(app, ['users.view']);

    const list = await api.get('/users');
    expect(list.status).toBe(200);
    for (const row of listOf<Record<string, unknown>>(list)) {
      expect(row.password).toBeUndefined();
    }
    expect(JSON.stringify(list.body)).not.toContain('password');
    // A bcrypt hash would start with $2; it must never appear in API output.
    expect(JSON.stringify(list.body)).not.toContain('$2$');
    expect(JSON.stringify(list.body)).not.toContain('$2a$');
    expect(JSON.stringify(list.body)).not.toContain('$2b$');

    const anyUser = listOf<{ id: string }>(list)[0];
    const detail = await api.get(`/users/${anyUser.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.password).toBeUndefined();
    expect(JSON.stringify(detail.body)).not.toContain('$2');
  });

  it('never returns the Session token from /api/auth/me', async () => {
    const user = await createUser({ permissions: ['clients.view'] });
    const api = await signIn(app, user);

    const session = await prisma.session.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(session).not.toBeNull();

    const res = await api.get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user.token).toBeUndefined();
    expect(res.body.data.user.sessions).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(session!.token);
  });
});

describe('secrets - the raw webhook value is never reachable even for an admin', () => {
  it('has no endpoint that returns the stored raw webhook URL', async () => {
    // The list/detail endpoints all mask or omit. Confirm across every route we
    // can call that the raw URL is nowhere in any response body.
    const responses = [
      await adminApi.get('/integrations'),
      await adminApi.get('/integrations/discord'),
      await adminApi.get('/integrations/smtp'),
    ];
    for (const res of responses) {
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(WEBHOOK_URL);
      expect(raw).not.toContain(WEBHOOK_TOKEN);
      expect(raw).not.toContain(WEBHOOK_ID);
    }
  });
});
