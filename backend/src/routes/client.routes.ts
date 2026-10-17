import { Router } from 'express';
import { z } from 'zod';
import { ClientStatus, ClientType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { sendCsv } from '../utils/csv';
import { writeAudit } from '../utils/audit';
import { logActivity } from '../services/activityService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, sendList } from './helpers';

export const clientsRouter = Router();

clientsRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'updatedAt', 'companyName', 'firstName', 'lastName', 'status'];

const clientBodySchema = z.object({
  type: z.nativeEnum(ClientType).optional(),
  companyName: z.string().trim().max(160).nullable().optional(),
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  email: z.string().email('A valid email is required'),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  website: z.string().trim().max(255).nullable().optional(),
  taxId: z.string().trim().max(80).nullable().optional(),
  status: z.nativeEnum(ClientStatus).optional(),
  leadSource: z.string().trim().max(120).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).optional(),
  notes: z.string().max(5000).nullable().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  accountManagerId: z.string().min(1).nullable().optional(),
});

const clientUpdateSchema = clientBodySchema.partial();

const contactSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  position: z.string().trim().max(120).nullable().optional(),
  isPrimary: z.boolean().optional(),
});

const noteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  isInternal: z.boolean().optional(),
});

clientsRouter.get(
  '/export',
  requirePermission('clients.export'),
  ah(async (req: AuthRequest, res) => {
    const clients = await prisma.client.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { projects: true, invoices: true } } },
    });
    return sendCsv(
      res,
      `clients-${new Date().toISOString().slice(0, 10)}.csv`,
      clients,
      [
        { header: 'Company', value: (row) => row.companyName ?? '' },
        { header: 'First name', value: (row) => row.firstName },
        { header: 'Last name', value: (row) => row.lastName },
        { header: 'Email', value: (row) => row.email },
        { header: 'Phone', value: (row) => row.phone ?? '' },
        { header: 'Status', value: (row) => row.status },
        { header: 'City', value: (row) => row.city ?? '' },
        { header: 'Country', value: (row) => row.country ?? '' },
        { header: 'Currency', value: (row) => row.currency },
        { header: 'Projects', value: (row) => row._count.projects },
        { header: 'Invoices', value: (row) => row._count.invoices },
        { header: 'Created', value: (row) => row.createdAt },
      ],
    );
  }),
);

clientsRouter.get(
  '/',
  requirePermission('clients.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'createdAt');
    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { companyName: { contains: query.search } },
              { firstName: { contains: query.search } },
              { lastName: { contains: query.search } },
              { email: { contains: query.search } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
      ...(req.query.status ? { status: String(req.query.status) as ClientStatus } : {}),
      ...(req.query.type ? { type: String(req.query.type) as ClientType } : {}),
      ...(req.query.accountManagerId ? { accountManagerId: String(req.query.accountManagerId) } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.client.findMany({
        where,
        include: { _count: { select: { projects: true, invoices: true, tickets: true } } },
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.client.count({ where }),
    ]);

    return sendList(res, items, total, query.page, query.limit);
  }),
);

clientsRouter.post(
  '/',
  requirePermission('clients.create'),
  validate(clientBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof clientBodySchema>;
    const client = await prisma.client.create({
      data: {
        type: data.type ?? 'BUSINESS',
        companyName: data.companyName ?? null,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email.toLowerCase(),
        phone: data.phone ?? null,
        address: data.address ?? null,
        city: data.city ?? null,
        country: data.country ?? null,
        website: data.website ?? null,
        taxId: data.taxId ?? null,
        status: data.status ?? 'ACTIVE',
        leadSource: data.leadSource ?? null,
        tags: data.tags ? (data.tags as Prisma.InputJsonValue) : undefined,
        notes: data.notes ?? null,
        currency: data.currency ?? 'LKR',
        accountManagerId: data.accountManagerId ?? null,
        createdById: req.user!.id,
      },
    });
    await logActivity({
      actorId: req.user!.id,
      action: 'client.created',
      entityType: 'Client',
      entityId: client.id,
      clientId: client.id,
      summary: `Client ${client.companyName || `${client.firstName} ${client.lastName}`} created`,
    });
    await writeAudit(req, { action: 'client.create', module: 'clients', entityId: client.id });
    return sendCreated(res, client, 'Client created successfully');
  }),
);

clientsRouter.get(
  '/:id',
  requirePermission('clients.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: {
        contacts: { orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }] },
        notesList: { orderBy: { createdAt: 'desc' }, take: 50 },
        _count: { select: { projects: true, invoices: true, tickets: true, quotations: true } },
      },
    });
    if (!client) throw new AppError('Client not found', 404);
    return sendSuccess(res, client);
  }),
);

clientsRouter.patch(
  '/:id',
  requirePermission('clients.update'),
  validate(idParamSchema, 'params'),
  validate(clientUpdateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof clientUpdateSchema>;
    const existing = await prisma.client.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!existing) throw new AppError('Client not found', 404);

    const client = await prisma.client.update({
      where: { id: existing.id },
      data: {
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.companyName !== undefined ? { companyName: data.companyName } : {}),
        ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
        ...(data.email !== undefined ? { email: data.email.toLowerCase() } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
        ...(data.website !== undefined ? { website: data.website } : {}),
        ...(data.taxId !== undefined ? { taxId: data.taxId } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.leadSource !== undefined ? { leadSource: data.leadSource } : {}),
        ...(data.tags !== undefined ? { tags: data.tags as Prisma.InputJsonValue } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.accountManagerId !== undefined ? { accountManagerId: data.accountManagerId } : {}),
      },
    });
    await writeAudit(req, { action: 'client.update', module: 'clients', entityId: client.id });
    return sendSuccess(res, client, { message: 'Client updated successfully' });
  }),
);

clientsRouter.delete(
  '/:id',
  requirePermission('clients.delete'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.client.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!existing) throw new AppError('Client not found', 404);
    await prisma.client.update({ where: { id: existing.id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } });
    await writeAudit(req, { action: 'client.archive', module: 'clients', entityId: existing.id });
    return sendNoContent(res);
  }),
);

clientsRouter.delete(
  '/:id/permanent',
  requirePermission('clients.delete'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.client.findFirst({
      where: { id: req.params.id },
      include: {
        _count: {
          select: {
            projects: true,
            invoices: true,
            quotations: true,
            orders: true,
            payments: true,
            refunds: true,
            tickets: true,
            attachments: true,
            activities: true,
          },
        },
      },
    });
    if (!existing) throw new AppError('Client not found', 404);

    await prisma.$transaction(async (tx) => {
      // Delete related records first to avoid FK constraints
      await tx.clientContact.deleteMany({ where: { clientId: existing.id } });
      await tx.clientNote.deleteMany({ where: { clientId: existing.id } });
      await tx.projectMember.deleteMany({ where: { project: { clientId: existing.id } } });
      await tx.milestone.deleteMany({ where: { project: { clientId: existing.id } } });
      await tx.task.deleteMany({ where: { project: { clientId: existing.id } } });
      await tx.projectUpdate.deleteMany({ where: { project: { clientId: existing.id } } });
      await tx.revisionRequest.deleteMany({ where: { project: { clientId: existing.id } } });
      await tx.timeEntry.deleteMany({ where: { project: { clientId: existing.id } } });
      await tx.checklistItem.deleteMany({ where: { project: { clientId: existing.id } } });
      await tx.memberEarning.deleteMany({ where: { project: { clientId: existing.id } } });
      await tx.allocationRule.deleteMany({ where: { project: { clientId: existing.id } } });
      await tx.expense.deleteMany({ where: { project: { clientId: existing.id } } });
      await tx.project.deleteMany({ where: { clientId: existing.id } });
      await tx.quotationItem.deleteMany({ where: { quotation: { clientId: existing.id } } });
      await tx.quotation.deleteMany({ where: { clientId: existing.id } });
      await tx.order.deleteMany({ where: { clientId: existing.id } });
      await tx.invoiceItem.deleteMany({ where: { invoice: { clientId: existing.id } } });
      await tx.invoice.deleteMany({ where: { clientId: existing.id } });
      await tx.payment.deleteMany({ where: { clientId: existing.id } });
      await tx.refund.deleteMany({ where: { clientId: existing.id } });
      await tx.ticketMessage.deleteMany({ where: { ticket: { clientId: existing.id } } });
      await tx.ticketMessage.deleteMany({ where: { ticket: { clientId: existing.id } } });
      await tx.ticket.deleteMany({ where: { clientId: existing.id } });
      await tx.attachment.deleteMany({ where: { clientId: existing.id } });
      await tx.activityLog.deleteMany({ where: { clientId: existing.id } });
      await tx.client.delete({ where: { id: existing.id } });
    });
    await writeAudit(req, { action: 'client.delete', module: 'clients', entityId: existing.id });
    return sendNoContent(res);
  }),
);

/* --------------------------------- Contacts -------------------------------- */

clientsRouter.post(
  '/:id/contacts',
  requirePermission('clients.update'),
  validate(idParamSchema, 'params'),
  validate(contactSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof contactSchema>;
    const client = await prisma.client.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!client) throw new AppError('Client not found', 404);

    const contact = await prisma.$transaction(async (tx) => {
      if (data.isPrimary) {
        await tx.clientContact.updateMany({ where: { clientId: client.id }, data: { isPrimary: false } });
      }
      return tx.clientContact.create({
        data: {
          clientId: client.id,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email ?? null,
          phone: data.phone ?? null,
          position: data.position ?? null,
          isPrimary: data.isPrimary ?? false,
        },
      });
    });
    return sendCreated(res, contact);
  }),
);

clientsRouter.patch(
  '/:id/contacts/:contactId',
  requirePermission('clients.update'),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof contactSchema>;
    const contact = await prisma.clientContact.findFirst({
      where: { id: req.params.contactId, clientId: req.params.id },
    });
    if (!contact) throw new AppError('Contact not found', 404);

    const updated = await prisma.$transaction(async (tx) => {
      if (data.isPrimary) {
        await tx.clientContact.updateMany({ where: { clientId: contact.clientId }, data: { isPrimary: false } });
      }
      return tx.clientContact.update({
        where: { id: contact.id },
        data: {
          ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
          ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
          ...(data.email !== undefined ? { email: data.email } : {}),
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          ...(data.position !== undefined ? { position: data.position } : {}),
          ...(data.isPrimary !== undefined ? { isPrimary: data.isPrimary } : {}),
        },
      });
    });
    return sendSuccess(res, updated);
  }),
);

clientsRouter.delete(
  '/:id/contacts/:contactId',
  requirePermission('clients.update'),
  ah(async (req: AuthRequest, res) => {
    const deleted = await prisma.clientContact.deleteMany({
      where: { id: req.params.contactId, clientId: req.params.id },
    });
    if (!deleted.count) throw new AppError('Contact not found', 404);
    return sendNoContent(res);
  }),
);

/* ----------------------------------- Notes --------------------------------- */

clientsRouter.post(
  '/:id/notes',
  requirePermission('clients.update'),
  validate(idParamSchema, 'params'),
  validate(noteSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof noteSchema>;
    const client = await prisma.client.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!client) throw new AppError('Client not found', 404);
    const note = await prisma.clientNote.create({
      data: {
        clientId: client.id,
        authorId: req.user!.id,
        body: data.body,
        isInternal: data.isInternal ?? true,
      },
    });
    return sendCreated(res, note);
  }),
);

clientsRouter.delete(
  '/:id/notes/:noteId',
  requirePermission('clients.update'),
  ah(async (req: AuthRequest, res) => {
    const deleted = await prisma.clientNote.deleteMany({ where: { id: req.params.noteId, clientId: req.params.id } });
    if (!deleted.count) throw new AppError('Note not found', 404);
    return sendNoContent(res);
  }),
);

/* --------------------------------- Activity -------------------------------- */

clientsRouter.get(
  '/:id/activity',
  requirePermission('clients.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const activities = await prisma.activityLog.findMany({
      where: { clientId: req.params.id },
      include: { actor: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return sendSuccess(res, activities);
  }),
);
