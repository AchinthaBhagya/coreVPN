import { Router } from 'express';
import { z } from 'zod';
import { Prisma, QuotationStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { logActivity } from '../services/activityService';
import { notifyPermissionHolders } from '../services/notificationService';
import { sendMail, quotationEmail } from '../services/emailService';
import { numbering } from '../services/numberingService';
import { computeDocumentTotals, LineItemInput } from '../services/financeService';
import { formatMoney } from '../utils/money';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, lineItemSchema, sendList } from './helpers';

export const quotationsRouter = Router();

quotationsRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'updatedAt', 'quotationNo', 'total', 'status', 'validUntil'];

const quotationBodySchema = z.object({
  clientId: z.string().min(1),
  serviceId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  currency: z.string().length(3).toUpperCase().optional(),
  taxRate: z.union([z.number(), z.string()]).optional(),
  validUntil: z.union([z.string(), z.date()]).nullable().optional(),
  terms: z.string().max(5000).nullable().optional(),
  internalNotes: z.string().max(5000).nullable().optional(),
  clientNotes: z.string().max(5000).nullable().optional(),
  items: z.array(lineItemSchema).min(1, 'At least one line item is required'),
});

const quotationUpdateSchema = quotationBodySchema.partial();

const respondSchema = z.object({
  decision: z.enum(['ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED']),
  reason: z.string().max(1000).nullable().optional(),
});

function lineCreate(items: ReturnType<typeof computeDocumentTotals>['lines']) {
  return items.map((line) => ({
    description: line.description,
    quantity: new Prisma.Decimal(line.quantity),
    unitPrice: new Prisma.Decimal(line.unitPrice),
    discount: new Prisma.Decimal(line.discount ?? 0),
    lineTotal: line.lineTotal,
    sortOrder: line.sortOrder ?? 0,
  }));
}

function clientName(client: { companyName: string | null; firstName: string; lastName: string }): string {
  return client.companyName || `${client.firstName} ${client.lastName}`;
}

quotationsRouter.get(
  '/',
  requirePermission('quotations.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'createdAt');
    const where: Prisma.QuotationWhereInput = {
      ...(query.search
        ? { OR: [{ quotationNo: { contains: query.search } }, { title: { contains: query.search } }] }
        : {}),
      ...(req.query.status ? { status: String(req.query.status) as QuotationStatus } : {}),
      ...(req.query.clientId ? { clientId: String(req.query.clientId) } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        include: { client: { select: { id: true, companyName: true, firstName: true, lastName: true } }, _count: { select: { items: true } } },
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.quotation.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

quotationsRouter.post(
  '/',
  requirePermission('quotations.create'),
  validate(quotationBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof quotationBodySchema>;
    const client = await prisma.client.findFirst({ where: { id: data.clientId, deletedAt: null } });
    if (!client) throw new AppError('Client not found', 404);

    const totals = computeDocumentTotals(data.items as LineItemInput[], data.taxRate ?? 0);

    const quotation = await prisma.$transaction(async (tx) => {
      const quotationNo = await numbering.quotationNumber(tx);
      return tx.quotation.create({
        data: {
          quotationNo,
          clientId: client.id,
          serviceId: data.serviceId ?? null,
          title: data.title,
          status: 'DRAFT',
          currency: data.currency ?? client.currency,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxRate: new Prisma.Decimal(data.taxRate ?? 0),
          taxTotal: totals.taxTotal,
          total: totals.total,
          validUntil: data.validUntil ? new Date(data.validUntil) : null,
          terms: data.terms ?? null,
          internalNotes: data.internalNotes ?? null,
          clientNotes: data.clientNotes ?? null,
          createdById: req.user!.id,
          items: { create: lineCreate(totals.lines) },
        },
        include: { items: true, client: true },
      });
    });

    await writeAudit(req, { action: 'quotation.create', module: 'quotations', entityId: quotation.id });
    return sendCreated(res, quotation, 'Quotation created successfully');
  }),
);

quotationsRouter.get(
  '/:id',
  requirePermission('quotations.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        client: true,
        service: { select: { id: true, name: true } },
        orders: { select: { id: true, orderNo: true, status: true } },
      },
    });
    if (!quotation) throw new AppError('Quotation not found', 404);
    return sendSuccess(res, quotation);
  }),
);

quotationsRouter.patch(
  '/:id',
  requirePermission('quotations.update'),
  validate(idParamSchema, 'params'),
  validate(quotationUpdateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof quotationUpdateSchema>;
    const existing = await prisma.quotation.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!existing) throw new AppError('Quotation not found', 404);
    if (existing.status !== 'DRAFT') throw new AppError('Only draft quotations can be edited', 409);

    const totals = data.items ? computeDocumentTotals(data.items as LineItemInput[], data.taxRate ?? existing.taxRate) : null;

    const quotation = await prisma.$transaction(async (tx) => {
      if (totals) {
        await tx.quotationItem.deleteMany({ where: { quotationId: existing.id } });
      }
      return tx.quotation.update({
        where: { id: existing.id },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.serviceId !== undefined ? { serviceId: data.serviceId } : {}),
          ...(data.currency !== undefined ? { currency: data.currency } : {}),
          ...(data.validUntil !== undefined ? { validUntil: data.validUntil ? new Date(data.validUntil) : null } : {}),
          ...(data.terms !== undefined ? { terms: data.terms } : {}),
          ...(data.internalNotes !== undefined ? { internalNotes: data.internalNotes } : {}),
          ...(data.clientNotes !== undefined ? { clientNotes: data.clientNotes } : {}),
          ...(totals
            ? {
                subtotal: totals.subtotal,
                discountTotal: totals.discountTotal,
                taxRate: new Prisma.Decimal(data.taxRate ?? existing.taxRate),
                taxTotal: totals.taxTotal,
                total: totals.total,
                items: { create: lineCreate(totals.lines) },
              }
            : {}),
        },
        include: { items: true, client: true },
      });
    });
    return sendSuccess(res, quotation, { message: 'Quotation updated successfully' });
  }),
);

quotationsRouter.delete(
  '/:id',
  requirePermission('quotations.delete'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.quotation.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Quotation not found', 404);
    if (existing.status !== 'DRAFT') throw new AppError('Only draft quotations can be deleted', 409);
    await prisma.quotation.delete({ where: { id: existing.id } });
    await writeAudit(req, { action: 'quotation.delete', module: 'quotations', entityId: existing.id });
    return sendNoContent(res);
  }),
);

quotationsRouter.post(
  '/:id/send',
  requirePermission('quotations.send'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.quotation.findUnique({ where: { id: req.params.id }, include: { client: true } });
    if (!existing) throw new AppError('Quotation not found', 404);
    if (existing.status !== 'DRAFT') throw new AppError('Only draft quotations can be sent', 409);

    const quotation = await prisma.quotation.update({
      where: { id: existing.id },
      data: { status: 'SENT', sentAt: new Date() },
      include: { client: true, items: true },
    });

    const mail = quotationEmail(
      quotation.quotationNo,
      clientName(quotation.client),
      formatMoney(quotation.total, quotation.currency),
    );
    await sendMail({ to: quotation.client.email, ...mail });

    await logActivity({
      actorId: req.user!.id,
      action: 'quotation.sent',
      entityType: 'Quotation',
      entityId: quotation.id,
      clientId: quotation.clientId,
      summary: `Quotation ${quotation.quotationNo} sent to ${clientName(quotation.client)}`,
      isClientVisible: true,
    });
    await notifyPermissionHolders('quotations.view', {
      type: 'QUOTATION_APPROVAL',
      title: 'Quotation sent',
      message: `${quotation.quotationNo} sent to ${clientName(quotation.client)}`,
      entityType: 'Quotation',
      entityId: quotation.id,
      link: `/quotations/${quotation.id}`,
      dedupeKey: `quotation-sent:${quotation.id}`,
    });
    return sendSuccess(res, quotation, { message: 'Quotation sent' });
  }),
);

quotationsRouter.post(
  '/:id/respond',
  requirePermission('quotations.update'),
  validate(idParamSchema, 'params'),
  validate(respondSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof respondSchema>;
    const existing = await prisma.quotation.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Quotation not found', 404);
    if (!['SENT', 'DRAFT'].includes(existing.status)) {
      throw new AppError('This quotation has already been decided', 409);
    }

    const quotation = await prisma.quotation.update({
      where: { id: existing.id },
      data: {
        status: data.decision,
        decidedAt: new Date(),
        rejectionReason: data.decision === 'REJECTED' ? data.reason ?? null : null,
      },
    });
    await writeAudit(req, {
      action: `quotation.${data.decision.toLowerCase()}`,
      module: 'quotations',
      entityId: quotation.id,
    });
    return sendSuccess(res, quotation, { message: `Quotation marked ${data.decision.toLowerCase()}` });
  }),
);

/** Converts an accepted quotation into a project (and optional delivery order). */
quotationsRouter.post(
  '/:id/convert',
  requirePermission('quotations.convert'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const quotation = await prisma.quotation.findUnique({ where: { id: req.params.id } });
    if (!quotation) throw new AppError('Quotation not found', 404);
    if (quotation.convertedProjectId) throw new AppError('This quotation has already been converted', 409);
    if (!['ACCEPTED', 'SENT'].includes(quotation.status)) {
      throw new AppError('Only accepted or sent quotations can be converted', 409);
    }

    const project = await prisma.$transaction(async (tx) => {
      const projectNo = await numbering.projectNumber(tx);
      const created = await tx.project.create({
        data: {
          projectNo,
          name: quotation.title,
          clientId: quotation.clientId,
          serviceId: quotation.serviceId,
          description: quotation.clientNotes ?? null,
          budget: quotation.total,
          currency: quotation.currency,
          status: 'PLANNING',
          managerId: req.user!.id,
          createdById: req.user!.id,
        },
      });
      await tx.quotation.update({
        where: { id: quotation.id },
        data: { status: 'ACCEPTED', convertedProjectId: created.id, decidedAt: new Date() },
      });
      // Seed a basic milestone from the quotation.
      await tx.milestone.create({
        data: { projectId: created.id, title: 'Project kick-off', status: 'PENDING', sortOrder: 0 },
      });
      return created;
    });

    await logActivity({
      actorId: req.user!.id,
      action: 'project.created',
      entityType: 'Project',
      entityId: project.id,
      projectId: project.id,
      clientId: project.clientId,
      summary: `Project ${project.projectNo} created from quotation ${quotation.quotationNo}`,
      isClientVisible: true,
    });
    await writeAudit(req, { action: 'quotation.convert', module: 'quotations', entityId: quotation.id, details: { projectId: project.id } });
    return sendCreated(res, project, 'Quotation converted to project');
  }),
);
