import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { ah, idParamSchema } from './helpers';

export const rolesRouter = Router();
export const permissionsRouter = Router();

rolesRouter.use(authenticate, denyClients());
permissionsRouter.use(authenticate, denyClients());

const roleBodySchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(255).nullable().optional(),
  permissions: z.array(z.string().min(1)).default([]),
});

const roleUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(255).nullable().optional(),
  permissions: z.array(z.string().min(1)).optional(),
});

async function resolvePermissions(names: string[]) {
  if (!names.length) return [];
  const found = await prisma.permission.findMany({ where: { name: { in: names } } });
  if (found.length !== names.length) {
    const known = new Set(found.map((p) => p.name));
    const missing = names.filter((name) => !known.has(name));
    throw new AppError(`Unknown permission(s): ${missing.join(', ')}`, 422);
  }
  return found;
}

permissionsRouter.get(
  '/',
  requirePermission('roles.view'),
  ah(async (_req: AuthRequest, res) => {
    const permissions = await prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { name: 'asc' }] });
    const grouped = permissions.reduce<Record<string, typeof permissions>>((acc, permission) => {
      (acc[permission.module] ??= []).push(permission);
      return acc;
    }, {});
    return sendSuccess(res, { all: permissions, grouped });
  }),
);

rolesRouter.get(
  '/',
  requirePermission('roles.view'),
  ah(async (_req: AuthRequest, res) => {
    const roles = await prisma.role.findMany({
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return sendSuccess(
      res,
      roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        type: role.type,
        isSystem: role.isSystem,
        userCount: role._count.userRoles,
        permissionCount: role.rolePermissions.length,
        permissions: role.rolePermissions.map((rp) => rp.permission.name),
      })),
    );
  }),
);

rolesRouter.get(
  '/:id',
  requirePermission('roles.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { rolePermissions: { include: { permission: true } }, _count: { select: { userRoles: true } } },
    });
    if (!role) throw new AppError('Role not found', 404);
    return sendSuccess(res, {
      ...role,
      permissions: role.rolePermissions.map((rp) => rp.permission.name),
    });
  }),
);

rolesRouter.post(
  '/',
  requirePermission('roles.manage'),
  validate(roleBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof roleBodySchema>;
    const permissions = await resolvePermissions(data.permissions);

    const role = await prisma.role.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        type: 'CUSTOM',
        isSystem: false,
        rolePermissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
      },
      include: { rolePermissions: { include: { permission: true } } },
    });
    await writeAudit(req, { action: 'role.create', module: 'roles', entityId: role.id, details: { name: role.name } });
    return sendCreated(res, { ...role, permissions: role.rolePermissions.map((rp) => rp.permission.name) });
  }),
);

rolesRouter.patch(
  '/:id',
  requirePermission('roles.manage'),
  validate(idParamSchema, 'params'),
  validate(roleUpdateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof roleUpdateSchema>;
    const role = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) throw new AppError('Role not found', 404);

    if (role.type === 'OWNER' && data.permissions) {
      throw new AppError('The Owner role always holds every permission and cannot be reduced', 400);
    }

    const permissions = data.permissions ? await resolvePermissions(data.permissions) : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      if (permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
          skipDuplicates: true,
        });
      }
      return tx.role.update({
        where: { id: role.id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
        },
        include: { rolePermissions: { include: { permission: true } } },
      });
    });

    await writeAudit(req, { action: 'role.update', module: 'roles', entityId: role.id });
    return sendSuccess(res, { ...updated, permissions: updated.rolePermissions.map((rp) => rp.permission.name) });
  }),
);

rolesRouter.delete(
  '/:id',
  requirePermission('roles.manage'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { userRoles: true } } },
    });
    if (!role) throw new AppError('Role not found', 404);
    if (role.isSystem) throw new AppError('System roles cannot be deleted', 400);
    if (role._count.userRoles > 0) throw new AppError('Reassign users before deleting this role', 409);

    await prisma.role.delete({ where: { id: role.id } });
    await writeAudit(req, { action: 'role.delete', module: 'roles', entityId: role.id, details: { name: role.name } });
    return sendNoContent(res);
  }),
);
