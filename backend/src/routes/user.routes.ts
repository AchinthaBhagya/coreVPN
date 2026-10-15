import { Router } from 'express';
import { z } from 'zod';
import { UserStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { hashPassword, validatePasswordPolicy } from '../utils/password';
import { writeAudit } from '../utils/audit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, sendList } from './helpers';
import { userAccessInclude } from './serializers';

export const usersRouter = Router();

usersRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'updatedAt', 'firstName', 'lastName', 'email', 'lastLogin', 'status'];

const createSchema = z.object({
  email: z.string().email(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(40).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  password: z.string().min(1),
  roleIds: z.array(z.string().min(1)).min(1, 'At least one role is required'),
  status: z.nativeEnum(UserStatus).optional(),
});

const updateSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  status: z.nativeEnum(UserStatus).optional(),
  roleIds: z.array(z.string().min(1)).min(1).optional(),
});

usersRouter.get(
  '/',
  requirePermission('users.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'createdAt');
    const where = {
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search } },
              { lastName: { contains: query.search } },
              { email: { contains: query.search } },
              { jobTitle: { contains: query.search } },
            ],
          }
        : {}),
      ...(req.query.status ? { status: String(req.query.status) as UserStatus } : {}),
      ...(req.query.roleId
        ? { userRoles: { some: { roleId: String(req.query.roleId) } } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: userAccessInclude,
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.user.count({ where }),
    ]);

    return sendList(res, items, total, query.page, query.limit);
  }),
);

/** Lightweight directory of internal users for assignment pickers. */
usersRouter.get(
  '/assignable',
  requirePermission('users.view'),
  ah(async (_req: AuthRequest, res) => {
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        userRoles: { some: { role: { type: { not: 'CLIENT' } } } },
      },
      select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true },
      orderBy: { firstName: 'asc' },
    });
    return sendSuccess(res, users);
  }),
);

usersRouter.post(
  '/',
  requirePermission('users.create'),
  validate(createSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof createSchema>;
    const policy = validatePasswordPolicy(data.password);
    if (!policy.valid) {
      const error = new AppError('Password does not meet the security policy', 422);
      (error as AppError & { errors?: unknown }).errors = policy.errors.map((message) => ({ field: 'password', message }));
      throw error;
    }

    const roles = await prisma.role.findMany({ where: { id: { in: data.roleIds } } });
    if (roles.length !== data.roleIds.length) throw new AppError('One or more roles were not found', 422);

    const created = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone ?? null,
        jobTitle: data.jobTitle ?? null,
        password: await hashPassword(data.password),
        status: data.status ?? 'ACTIVE',
        createdById: req.user!.id,
        userRoles: { create: data.roleIds.map((roleId) => ({ roleId })) },
      },
      include: userAccessInclude,
    });

    await writeAudit(req, { action: 'user.create', module: 'users', entityId: created.id, details: { roles: data.roleIds } });
    return sendCreated(res, created, 'User created successfully');
  }),
);

usersRouter.get(
  '/:id',
  requirePermission('users.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: userAccessInclude,
    });
    if (!user) throw new AppError('User not found', 404);
    return sendSuccess(res, user);
  }),
);

usersRouter.patch(
  '/:id',
  requirePermission('users.update'),
  validate(idParamSchema, 'params'),
  validate(updateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof updateSchema>;
    const existing = await prisma.user.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!existing) throw new AppError('User not found', 404);

    if (data.roleIds) {
      const roles = await prisma.role.findMany({ where: { id: { in: data.roleIds } } });
      if (roles.length !== data.roleIds.length) throw new AppError('One or more roles were not found', 422);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (data.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: existing.id } });
        await tx.userRole.createMany({
          data: data.roleIds.map((roleId) => ({ userId: existing.id, roleId })),
          skipDuplicates: true,
        });
      }
      return tx.user.update({
        where: { id: existing.id },
        data: {
          ...(data.email !== undefined ? { email: data.email.toLowerCase() } : {}),
          ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
          ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          ...(data.jobTitle !== undefined ? { jobTitle: data.jobTitle } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
        },
        include: userAccessInclude,
      });
    });

    await writeAudit(req, { action: 'user.update', module: 'users', entityId: updated.id });
    return sendSuccess(res, updated, { message: 'User updated successfully' });
  }),
);

usersRouter.post(
  '/:id/reset-password',
  requirePermission('users.update'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const policy = validatePasswordPolicy(String(req.body?.password ?? ''));
    if (!policy.valid) {
      const error = new AppError('Password does not meet the security policy', 422);
      (error as AppError & { errors?: unknown }).errors = policy.errors.map((message) => ({ field: 'password', message }));
      throw error;
    }
    const user = await prisma.user.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!user) throw new AppError('User not found', 404);
    // Only an owner may reset another owner's password.
    if (user.id !== req.user!.id && !req.user!.roles.some((r) => r.type === 'OWNER')) {
      throw new AppError('Only an owner can reset this password', 403);
    }
    await prisma.user.update({ where: { id: user.id }, data: { password: await hashPassword(String(req.body.password)) } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await writeAudit(req, { action: 'user.password.reset', module: 'users', entityId: user.id });
    return sendSuccess(res, { reset: true }, { message: 'Password reset. The user must sign in again.' });
  }),
);

usersRouter.delete(
  '/:id',
  requirePermission('users.delete'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const user = await prisma.user.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!user) throw new AppError('User not found', 404);
    if (user.id === req.user!.id) throw new AppError('You cannot deactivate your own account', 400);

    const ownerCount = await prisma.user.count({
      where: { deletedAt: null, status: 'ACTIVE', userRoles: { some: { role: { type: 'OWNER' } } } },
    });
    const targetIsOwner = await prisma.userRole.findFirst({ where: { userId: user.id, role: { type: 'OWNER' } } });
    if (targetIsOwner && ownerCount <= 1) {
      throw new AppError('At least one active owner must remain', 400);
    }

    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date(), status: 'INACTIVE' } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await writeAudit(req, { action: 'user.deactivate', module: 'users', entityId: user.id });
    return sendNoContent(res);
  }),
);
