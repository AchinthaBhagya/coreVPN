import { Router } from 'express';
import { z } from 'zod';
import { Prisma, ServiceStatus, ServicePricingModel } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, moneySchema, sendList } from './helpers';

export const servicesRouter = Router();

servicesRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'updatedAt', 'name', 'category', 'basePrice', 'status'];

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const serviceBodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(1).max(80),
  shortDescription: z.string().max(500).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  publicDescription: z.string().max(5000).nullable().optional(),
  internalInstructions: z.string().max(5000).nullable().optional(),
  pricingModel: z.nativeEnum(ServicePricingModel).optional(),
  basePrice: moneySchema.optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  estimatedDelivery: z.string().trim().max(120).nullable().optional(),
  status: z.nativeEnum(ServiceStatus).optional(),
  icon: z.string().trim().max(80).nullable().optional(),
});

const serviceUpdateSchema = serviceBodySchema.partial();

servicesRouter.get(
  '/',
  requirePermission('services.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'name');
    const where: Prisma.ServiceWhereInput = {
      deletedAt: null,
      ...(query.search
        ? { OR: [{ name: { contains: query.search } }, { category: { contains: query.search } }] }
        : {}),
      ...(req.query.status ? { status: String(req.query.status) as ServiceStatus } : {}),
      ...(req.query.category ? { category: String(req.query.category) } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.service.findMany({ where, orderBy: { [sortBy]: query.sortDir }, skip: query.skip, take: query.take }),
      prisma.service.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

servicesRouter.post(
  '/',
  requirePermission('services.manage'),
  validate(serviceBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof serviceBodySchema>;
    let slug = toSlug(data.name);
    if (!slug) slug = `service-${Date.now()}`;
    // Guarantee a unique slug.
    const clash = await prisma.service.findUnique({ where: { slug } });
    if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

    const service = await prisma.service.create({
      data: {
        name: data.name,
        slug,
        category: data.category,
        shortDescription: data.shortDescription ?? null,
        description: data.description ?? null,
        publicDescription: data.publicDescription ?? null,
        internalInstructions: data.internalInstructions ?? null,
        pricingModel: data.pricingModel ?? 'FIXED',
        basePrice: data.basePrice ?? '0',
        currency: data.currency ?? 'LKR',
        estimatedDelivery: data.estimatedDelivery ?? null,
        status: data.status ?? 'ACTIVE',
        icon: data.icon ?? null,
      },
    });
    await writeAudit(req, { action: 'service.create', module: 'services', entityId: service.id });
    return sendCreated(res, service);
  }),
);

servicesRouter.get(
  '/:id',
  requirePermission('services.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const service = await prisma.service.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!service) throw new AppError('Service not found', 404);
    return sendSuccess(res, service);
  }),
);

servicesRouter.patch(
  '/:id',
  requirePermission('services.manage'),
  validate(idParamSchema, 'params'),
  validate(serviceUpdateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof serviceUpdateSchema>;
    const existing = await prisma.service.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!existing) throw new AppError('Service not found', 404);

    const service = await prisma.service.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.shortDescription !== undefined ? { shortDescription: data.shortDescription } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.publicDescription !== undefined ? { publicDescription: data.publicDescription } : {}),
        ...(data.internalInstructions !== undefined ? { internalInstructions: data.internalInstructions } : {}),
        ...(data.pricingModel !== undefined ? { pricingModel: data.pricingModel } : {}),
        ...(data.basePrice !== undefined ? { basePrice: data.basePrice } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.estimatedDelivery !== undefined ? { estimatedDelivery: data.estimatedDelivery } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
      },
    });
    return sendSuccess(res, service, { message: 'Service updated successfully' });
  }),
);

servicesRouter.delete(
  '/:id',
  requirePermission('services.manage'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.service.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!existing) throw new AppError('Service not found', 404);
    await prisma.service.update({ where: { id: existing.id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } });
    await writeAudit(req, { action: 'service.archive', module: 'services', entityId: existing.id });
    return sendNoContent(res);
  }),
);
