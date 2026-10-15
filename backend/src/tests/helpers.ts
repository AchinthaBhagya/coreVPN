import request, { Test, Response } from 'supertest';
import type { Express } from 'express';
import { prisma } from '../config/prisma';
import { PERMISSIONS, ROLE_TEMPLATES } from '../config/permissions';
import { hashPassword } from '../utils/password';

export const ORIGIN = 'http://localhost:5173';

export interface TestUser {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Wipes every table in the test database. Runs inside one transaction so the
 * `FOREIGN_KEY_CHECKS` toggle definitely applies to the same connection that
 * executes the TRUNCATEs.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    const rows = await tx.$queryRaw<Array<{ TABLE_NAME: string }>>`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`;
    for (const row of rows) {
      await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${row.TABLE_NAME}\``);
    }
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  });
}

/** Installs the permission catalogue and default role templates (idempotent). */
export async function seedCatalogue(): Promise<void> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: { module: permission.module, description: permission.description },
      create: permission,
    });
  }
  const allPermissions = await prisma.permission.findMany({ select: { id: true, name: true } });
  const idByName = new Map(allPermissions.map((row) => [row.name, row.id]));

  for (const template of ROLE_TEMPLATES) {
    const role = await prisma.role.upsert({
      where: { name: template.name },
      update: { type: template.type, description: template.description },
      create: { name: template.name, description: template.description, type: template.type, isSystem: true },
    });
    const desiredIds = template.permissions
      .map((name) => idByName.get(name))
      .filter((id): id is string => Boolean(id));
    const current = await prisma.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionId: true } });
    const currentIds = new Set(current.map((row) => row.permissionId));
    const toAdd = desiredIds.filter((id) => !currentIds.has(id));
    const toRemove = current.filter((row) => !desiredIds.includes(row.permissionId));
    if (toRemove.length) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: toRemove.map((row) => row.permissionId) } },
      });
    }
    if (toAdd.length) {
      await prisma.rolePermission.createMany({ data: toAdd.map((permissionId) => ({ roleId: role.id, permissionId })) });
    }
  }
}

/** Creates (or reuses) a role holding exactly the named permissions. */
export async function createRole(
  name: string,
  permissionNames: string[],
  type: 'ADMIN' | 'CLIENT' | 'CUSTOM' = 'CUSTOM',
): Promise<string> {
  const permissionIds: string[] = [];
  for (const permissionName of permissionNames) {
    const definition = PERMISSIONS.find((permission) => permission.name === permissionName);
    const row = await prisma.permission.upsert({
      where: { name: permissionName },
      update: {},
      create: {
        name: permissionName,
        module: definition?.module ?? permissionName.split('.')[0],
        description: definition?.description ?? null,
      },
    });
    permissionIds.push(row.id);
  }

  const role = await prisma.role.upsert({
    where: { name },
    update: { type },
    create: { name, type },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  if (permissionIds.length) {
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
    });
  }
  return role.id;
}

export interface CreateUserOptions {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  status?: 'ACTIVE' | 'PENDING' | 'INACTIVE';
  permissions?: string[];
  roleIds?: string[];
  clientId?: string;
}

/** Creates a staff user with the given permissions (default password is strong). */
export async function createUser(options: CreateUserOptions = {}): Promise<TestUser> {
  const password = options.password ?? 'TestPass!2026x';
  const email = options.email ?? `user${Date.now()}${Math.floor(Math.random() * 10000)}@test.local`;
  const user = await prisma.user.create({
    data: {
      email,
      password: await hashPassword(password),
      firstName: options.firstName ?? 'Test',
      lastName: options.lastName ?? 'User',
      status: options.status ?? 'ACTIVE',
      ...(options.roleIds?.length ? { userRoles: { create: options.roleIds.map((roleId) => ({ roleId })) } } : {}),
      ...(options.clientId ? { client: { connect: { id: options.clientId } } } : {}),
    },
  });

  if (options.permissions?.length) {
    const roleId = await createRole(`temp-role-${user.id}`, options.permissions);
    await prisma.userRole.create({ data: { userId: user.id, roleId } });
  }

  return { id: user.id, email: user.email, password, firstName: user.firstName, lastName: user.lastName };
}

/** Creates a client organization plus its portal login (role type CLIENT). */
export async function createClientWithPortalUser(
  label = 'Acme',
  ownerPermissions: string[] = ['tickets.view', 'tickets.respond'],
): Promise<{ clientId: string; user: TestUser }> {
  const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '')}${Math.floor(Math.random() * 100000)}@client.test`;
  const client = await prisma.client.create({
    data: {
      companyName: `${label} Ltd`,
      firstName: label,
      lastName: 'Client',
      email,
      currency: 'LKR',
      status: 'ACTIVE',
    },
  });
  const roleId = await createRole(`portal-role-${client.id}`, ownerPermissions, 'CLIENT');
  const password = 'ClientPass!2026x';
  const user = await prisma.user.create({
    data: {
      email,
      password: await hashPassword(password),
      firstName: label,
      lastName: 'Client',
      status: 'ACTIVE',
      userRoles: { create: [{ roleId }] },
      client: { connect: { id: client.id } },
    },
  });
  await prisma.client.update({ where: { id: client.id }, data: { userId: user.id } });

  return { clientId: client.id, user: { id: user.id, email: user.email, password, firstName: label, lastName: 'Client' } };
}

export interface RequestOptions {
  /** Send the X-CSRF-Token header (default true). */
  csrf?: boolean;
  /** Origin header value; `null` omits it entirely. */
  origin?: string | null;
}

/**
 * Cookie-aware API client. Mirrors how the SPA talks to the API: cookie
 * session + CSRF double-submit + Origin header on every write.
 *
 * Cookies are tracked manually (not via `request.agent`) because supertest's
 * shared-server lifecycle races with sequential awaited requests.
 */
export class Api {
  private readonly app: Express;
  private readonly cookies = new Map<string, string>();
  private csrfTokenValue: string | null = null;

  constructor(app: Express) {
    this.app = app;
  }

  /** Applies the stored cookie jar to a fresh request for this app. */
  private req(method: 'get' | 'post' | 'put' | 'patch' | 'delete', apiPath: string): Test {
    const test = request(this.app)[method](apiPath);
    const header = this.cookieHeader();
    if (header) test.set('Cookie', header);
    return test;
  }

  private cookieHeader(): string {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join('; ');
  }

  private capture(res: Response): void {
    const setCookie: unknown = res.headers['set-cookie'];
    for (const raw of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const [pair] = String(raw).split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    const token = (res.body as { data?: { csrfToken?: unknown } } | undefined)?.data?.csrfToken;
    if (typeof token === 'string' && token) this.csrfTokenValue = token;
  }

  /** Returns the current CSRF token (fetched once, refreshed by login). */
  async csrf(): Promise<string> {
    if (this.csrfTokenValue) return this.csrfTokenValue;
    const res = await this.get('/auth/csrf');
    if (!this.csrfTokenValue) throw new Error(`No CSRF token in response: ${res.status}`);
    return this.csrfTokenValue;
  }

  async get(path: string, options: RequestOptions = {}): Promise<Response> {
    let req = this.req('get', `/api${path}`);
    if (options.origin !== null) req = req.set('Origin', options.origin ?? ORIGIN);
    const res = await req;
    this.capture(res);
    return res;
  }

  private build(method: 'post' | 'put' | 'patch' | 'delete', path: string, options: RequestOptions = {}): Test {
    let req = this.req(method, `/api${path}`);
    if (options.origin !== null) req = req.set('Origin', options.origin ?? ORIGIN);
    if (options.csrf !== false) req = req.set('X-CSRF-Token', this.csrfTokenValue as string);
    return req;
  }

  /** Fetches the CSRF token when the caller wants CSRF protection. */
  private async ensureCsrf(options?: RequestOptions): Promise<void> {
    if (options?.csrf !== false) await this.csrf();
  }

  async post(path: string, body?: unknown, options?: RequestOptions): Promise<Response> {
    await this.ensureCsrf(options);
    const req = this.build('post', path, options);
    if (body !== undefined) req.send(body as object);
    const res = await req;
    this.capture(res);
    return res;
  }

  async patch(path: string, body?: unknown, options?: RequestOptions): Promise<Response> {
    await this.ensureCsrf(options);
    const req = this.build('patch', path, options);
    if (body !== undefined) req.send(body as object);
    const res = await req;
    this.capture(res);
    return res;
  }

  async put(path: string, body?: unknown, options?: RequestOptions): Promise<Response> {
    await this.ensureCsrf(options);
    const req = this.build('put', path, options);
    if (body !== undefined) req.send(body as object);
    const res = await req;
    this.capture(res);
    return res;
  }

  async del(path: string, options?: RequestOptions): Promise<Response> {
    await this.ensureCsrf(options);
    const req = this.build('delete', path, options);
    const res = await req;
    this.capture(res);
    return res;
  }

  /** Multipart upload (files first, then fields - superagent requirement). */
  async upload(
    path: string,
    files: Array<{ field: string; buffer: Buffer; filename: string; contentType?: string }>,
    fields: Record<string, string> = {},
    options?: RequestOptions,
  ): Promise<Response> {
    await this.ensureCsrf(options);
    const req = this.build('post', path, options);
    for (const file of files) {
      req.attach(file.field, file.buffer, { filename: file.filename, contentType: file.contentType });
    }
    for (const [name, value] of Object.entries(fields)) req.field(name, value);
    const res = await req;
    this.capture(res);
    return res;
  }

  async login(email: string, password: string, options?: RequestOptions): Promise<Response> {
    const res = await this.post('/auth/login', { email, password }, options);
    if (res.status === 200) {
      // Login rotates the CSRF cookie; re-read it before the next write.
      this.csrfTokenValue = null;
      await this.csrf();
    }
    return res;
  }
}

/** Creates an Api client already signed in as the given user. */
export async function signIn(app: Express, user: { email: string; password: string }): Promise<Api> {
  const api = new Api(app);
  const res = await api.login(user.email, user.password);
  if (res.status !== 200) {
    throw new Error(`Login failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return api;
}

/** Convenience: create a user with permissions and sign them in. */
export async function signInWithPermissions(app: Express, permissions: string[]): Promise<{ api: Api; user: TestUser }> {
  const user = await createUser({ permissions });
  const api = await signIn(app, user);
  return { api, user };
}

/** Extracts the list payload from a paginated response. */
export function listOf<T = Record<string, unknown>>(res: Response): T[] {
  if (!Array.isArray(res.body?.data)) {
    throw new Error(`Expected a list payload, got: ${JSON.stringify(res.body).slice(0, 400)}`);
  }
  return res.body.data as T[];
}
