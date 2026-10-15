import { Router } from 'express';
import { z } from 'zod';
import { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { numbering } from '../services/numberingService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, optionalMoneySchema, sendList } from './helpers';

export const ordersRouter = Router();

ordersRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'updatedAt', 'orderNo', 'status', 'expectedDelivery'];

const orderBodySchema = z.object({
  clientId: z.string().min(1),
  serviceId: z.string().min(1).nullable().optional(),
  quotationId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  requirements: z.string().max(5000).nullable().optional(),
  budget: optionalMoneySchema,
  currency: z.string().length(3).toUpperCase().optional(),
  expectedDelivery: z.union([z.string(), z.date()]).nullable().optional(),
  assignedToId: z.string().min(1).nullable().optional(),
});

const orderUpdateSchema = orderBodySchema.partial().extend({
  status: z.nativeEnum(OrderStatus).optional(),
});

ordersRouter.get(
  '/',
  requirePermission('orders.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'createdAt');
    const where: Prisma.OrderWhereInput = {
      ...(query.search ? { OR: [{ orderNo: { contains: query.search } }, { title: { contains: query.search } }] } : {}),
      ...(req.query.status ? { status: String(req.query.status) as OrderStatus } : {}),
      ...(req.query.clientId ? { clientId: String(req.query.clientId) } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true, firstName: true, lastName: true } },
          service: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.order.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

ordersRouter.post(
  '/',
  requirePermission('orders.create'),
  validate(orderBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof orderBodySchema>;
    const client = await prisma.client.findFirst({ where: { id: data.clientId, deletedAt: null } });
    if (!client) throw new AppError('Client not found', 404);

    const order = await prisma.$transaction(async (tx) => {
      const orderNo = await numbering.orderNumber(tx);
      return tx.order.create({
        data: {
          orderNo,
          clientId: client.id,
          serviceId: data.serviceId ?? null,
          quotationId: data.quotationId ?? null,
          title: data.title,
          requirements: data.requirements ?? null,
          budget: data.budget ?? null,
          currency: data.currency ?? client.currency,
          expectedDelivery: data.expectedDelivery ? new Date(data.expectedDelivery) : null,
          status: 'DRAFT',
          assignedToId: data.assignedToId ?? null,
          createdById: req.user!.id,
        },
      });
    });
    await writeAudit(req, { action: 'order.create', module: 'orders', entityId: order.id });
    return sendCreated(res, order);
  }),
);

ordersRouter.get(
  '/:id',
  requirePermission('orders.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { client: true, service: true, quotation: { select: { id: true, quotationNo: true } }, invoices: true },
    });
    if (!order) throw new AppError('Order not found', 404);
    return sendSuccess(res, order);
  }),
);

ordersRouter.patch(
  '/:id',
  requirePermission('orders.update'),
  validate(idParamSchema, 'params'),
  validate(orderUpdateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof orderUpdateSchema>;
    const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Order not found', 404);

    const order = await prisma.order.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.serviceId !== undefined ? { serviceId: data.serviceId } : {}),
        ...(data.quotationId !== undefined ? { quotationId: data.quotationId } : {}),
        ...(data.requirements !== undefined ? { requirements: data.requirements } : {}),
        ...(data.budget !== undefined ? { budget: data.budget } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.expectedDelivery !== undefined
          ? { expectedDelivery: data.expectedDelivery ? new Date(data.expectedDelivery) : null }
          : {}),
        ...(data.assignedToId !== undefined ? { assignedToId: data.assignedToId } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
    await writeAudit(req, { action: 'order.update', module: 'orders', entityId: order.id });
    return sendSuccess(res, order, { message: 'Order updated successfully' });
  }),
);

ordersRouter.delete(
  '/:id',
  requirePermission('orders.update'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Order not found', 404);
    if (existing.status !== 'DRAFT') throw new AppError('Only draft orders can be deleted', 409);
    await prisma.order.delete({ where: { id: existing.id } });
    await writeAudit(req, { action: 'order.delete', module: 'orders', entityId: existing.id });
    return sendNoContent(res);
  }),
);
