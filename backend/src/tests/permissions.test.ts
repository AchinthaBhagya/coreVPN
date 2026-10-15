import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../app';
import {
  createClientWithPortalUser,
  createUser,
  listOf,
  resetDatabase,
  seedCatalogue,
  signIn,
  signInWithPermissions,
} from './helpers';
import { prisma } from '../config/prisma';

let app: Express;

beforeAll(async () => {
  app = createApp();
  await resetDatabase();
  await seedCatalogue();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;
function clientBody(label: string) {
  counter += 1;
  return {
    firstName: 'New',
    lastName: `${label}${counter}`,
    email: `perm-${label.toLowerCase()}${counter}-${Date.now()}@test.local`,
  };
}

describe('permissions - clients module enforcement', () => {
  it('denies a user with no permissions on both list and create', async () => {
    const { api } = await signInWithPermissions(app, []);

    const list = await api.get('/clients');
    expect(list.status).toBe(403);
    expect(list.body.success).toBe(false);

    const create = await api.post('/clients', clientBody('NoPerm'));
    expect(create.status).toBe(403);
  });

  it('allows clients.view to list but denies creating', async () => {
    const { api } = await signInWithPermissions(app, ['clients.view']);

    const list = await api.get('/clients');
    expect(list.status).toBe(200);
    expect(Array.isArray(listOf(list))).toBe(true);

    const create = await api.post('/clients', clientBody('ViewOnly'));
    expect(create.status).toBe(403);
  });

  it('allows a users.create-style holder to create a client with clients.create', async () => {
    const { api } = await signInWithPermissions(app, ['clients.create']);

    const create = await api.post('/clients', clientBody('Creator'));
    expect(create.status).toBe(201);
    expect(create.body.success).toBe(true);
    expect(create.body.data.email).toBeDefined();
  });

  it('requires clients.delete to archive a client', async () => {
    const victim = await prisma.client.create({
      data: {
        firstName: 'Victim',
        lastName: 'Client',
        email: `victim-${Date.now()}@test.local`,
        currency: 'LKR',
        status: 'ACTIVE',
      },
    });

    const updaters = await signInWithPermissions(app, ['clients.view', 'clients.update']);
    const denied = await updaters.api.del(`/clients/${victim.id}`);
    expect(denied.status).toBe(403);

    const deleters = await signInWithPermissions(app, ['clients.view', 'clients.delete']);
    const allowed = await deleters.api.del(`/clients/${victim.id}`);
    expect(allowed.status).toBe(204);

    const reloaded = await prisma.client.findUnique({ where: { id: victim.id } });
    expect(reloaded!.deletedAt).not.toBeNull();
    expect(reloaded!.status).toBe('ARCHIVED');
  });
});

describe('permissions - client (portal) accounts are locked out of staff endpoints', () => {
  it('returns 403 for a CLIENT-role user hitting GET /api/clients', async () => {
    // NOTE: the clients router guards the whole router with `denyClients()`, so a
    // portal account is rejected before any record scoping is considered. The
    // response is 403 ("Not available for client accounts"), not 404 - staff
    // endpoints are simply not available to client accounts at all.
    const { user } = await createClientWithPortalUser('PortalStaff', ['tickets.view']);
    const api = await signIn(app, user);

    const list = await api.get('/clients');
    expect(list.status).toBe(403);
    expect(list.body.message).toMatch(/client account/i);
  });
});

describe('permissions - Owner role template', () => {
  it('grants a large permission set (> 50) to the Owner role', async () => {
    const owner = await prisma.role.findUnique({ where: { name: 'Owner' }, select: { id: true } });
    expect(owner).not.toBeNull();

    const count = await prisma.rolePermission.count({ where: { roleId: owner!.id } });
    expect(count).toBeGreaterThan(50);

    // And an Owner user surfaces that full set on /auth/me.
    const user = await createUser({ roleIds: [owner!.id] });
    const api = await signIn(app, user);
    const me = await api.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.permissions.length).toBeGreaterThan(50);
    expect(me.body.data.user.permissions).toContain('settings.integrations');
  });
});
