import { Router } from 'express';
import { z } from 'zod';
import { InvoiceStatus, Prisma, ProjectStatus, QuotationStatus, TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { logActivity } from '../services/activityService';
import { createNotification, notifyPermissionHolders } from '../services/notificationService';
import { numbering } from '../services/numberingService';
import { generateInvoicePdf } from '../services/pdfService';
import { getClientDashboard } from '../services/dashboardService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireClientAccount, requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { ah, idParamSchema, requireClientId, sendList } from './helpers';
import { parseListQuery } from '../utils/pagination';

export const portalRouter = Router();

// The portal is only ever reachable by accounts linked to a client record.
portalRouter.use(authenticate, requireClientAccount());

async function getCompanyProfile() {
  const settings = await prisma.companySetting.findUnique({ where: { id: 'default' } });
  return {
    name: settings?.companyName ?? '3xCodz',
    legalName: settings?.legalName ?? null,
    address: settings?.address ?? null,
    email: settings?.email ?? null,
    phone: settings?.phone ?? null,
    website: settings?.website ?? null,
    taxId: settings?.taxId ?? null,
    currency: settings?.currency ?? 'LKR',
    paymentTermsDays: settings?.paymentTermsDays ?? 14,
  };
}

/* --------------------------------- Dashboard ------------------------------- */

portalRouter.get(
  '/dashboard',
  requirePermission('portal.projects.view'),
  ah(async (req: AuthRequest, res) => {
    const data = await getClientDashboard(requireClientId(req));
    return sendSuccess(res, data);
  }),
);

/* --------------------------------- Projects -------------------------------- */

portalRouter.get(
  '/projects',
  requirePermission('portal.projects.view'),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const query = parseListQuery(req);
    const where: Prisma.ProjectWhereInput = {
      clientId,
      deletedAt: null,
      ...(req.query.status ? { status: String(req.query.status) as ProjectStatus } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.project.findMany({
        where,
        select: {
          id: true, projectNo: true, name: true, description: true, status: true,
          priority: true, progress: true, currency: true, startDate: true, deadline: true,
          completedAt: true, createdAt: true, updatedAt: true,
          service: { select: { name: true, category: true } },
          _count: { select: { milestones: true, updates: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.project.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

portalRouter.get(
  '/projects/:id',
  requirePermission('portal.projects.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, clientId, deletedAt: null },
      select: {
        id: true, projectNo: true, name: true, description: true, status: true,
        priority: true, progress: true, currency: true, startDate: true, deadline: true,
        completedAt: true, createdAt: true, updatedAt: true,
        service: { select: { name: true, category: true } },
        milestones: {
          where: { isClientVisible: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, title: true, description: true, dueDate: true, completedAt: true, status: true },
        },
        updates: {
          where: { isClientVisible: true },
          orderBy: { createdAt: 'desc' },
          select: { id: true, title: true, body: true, createdAt: true, author: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!project) throw new AppError('Project not found', 404);

    const activity = await prisma.activityLog.findMany({
      where: { projectId: project.id, isClientVisible: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, action: true, summary: true, createdAt: true },
    });
    return sendSuccess(res, { ...project, activity });
  }),
);

/* ---------------------------------- Invoices ------------------------------- */

portalRouter.get(
  '/invoices',
  requirePermission('portal.invoices.view'),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const query = parseListQuery(req);
    // Draft and void invoices are internal-only; a client can never widen this.
    const clientVisibleInvoiceStatuses = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'REFUNDED'];
    const requestedStatus = req.query.status ? String(req.query.status) : undefined;
    const where: Prisma.InvoiceWhereInput = {
      clientId,
      status:
        requestedStatus && clientVisibleInvoiceStatuses.includes(requestedStatus)
          ? (requestedStatus as InvoiceStatus)
          : { notIn: ['DRAFT', 'VOID'] },
    };
    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        select: {
          id: true, invoiceNo: true, status: true, currency: true, issueDate: true, dueDate: true,
          total: true, amountPaid: true, balance: true, paidAt: true,
          project: { select: { id: true, name: true, projectNo: true } },
        },
        orderBy: { issueDate: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.invoice.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

portalRouter.get(
  '/invoices/:id',
  requirePermission('portal.invoices.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, clientId, status: { notIn: ['DRAFT', 'VOID'] } },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        project: { select: { id: true, name: true, projectNo: true } },
        payments: { where: { isVoid: false }, orderBy: { paidAt: 'desc' }, select: { id: true, paymentNo: true, amount: true, currency: true, method: true, paidAt: true, reference: true } },
      },
    });
    if (!invoice) throw new AppError('Invoice not found', 404);
    return sendSuccess(res, invoice);
  }),
);

portalRouter.get(
  '/invoices/:id/pdf',
  requirePermission('portal.invoices.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, clientId, status: { notIn: ['DRAFT', 'VOID'] } },
      include: { items: { orderBy: { sortOrder: 'asc' } }, client: true },
    });
    if (!invoice) throw new AppError('Invoice not found', 404);

    const company = await getCompanyProfile();
    const buffer = await generateInvoicePdf({
      company,
      client: {
        name: `${invoice.client.firstName} ${invoice.client.lastName}`,
        company: invoice.client.companyName,
        email: invoice.client.email,
        phone: invoice.client.phone,
        address: invoice.client.address,
      },
      invoice: {
        invoiceNo: invoice.invoiceNo,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        status: invoice.status,
        currency: invoice.currency,
        subtotal: invoice.subtotal.toString(),
        discountTotal: invoice.discountTotal.toString(),
        taxRate: invoice.taxRate.toString(),
        taxTotal: invoice.taxTotal.toString(),
        total: invoice.total.toString(),
        amountPaid: invoice.amountPaid.toString(),
        balance: invoice.balance.toString(),
        notes: invoice.notes,
        terms: invoice.terms,
        items: invoice.items.map((item) => ({
          description: item.description,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          discount: item.discount.toString(),
          lineTotal: item.lineTotal.toString(),
        })),
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNo}.pdf"`);
    return res.status(200).send(buffer);
  }),
);

/* --------------------------------- Quotations ------------------------------ */

portalRouter.get(
  '/quotations',
  requirePermission('portal.quotations.view'),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const query = parseListQuery(req);
    // A client only ever sees quotations that have left the internal draft stage.
    const requestedStatus = req.query.status ? String(req.query.status) : undefined;
    const where: Prisma.QuotationWhereInput = {
      clientId,
      status:
        requestedStatus && requestedStatus !== 'DRAFT'
          ? (requestedStatus as QuotationStatus)
          : { not: 'DRAFT' },
    };
    const [items, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        select: {
          id: true, quotationNo: true, title: true, status: true, currency: true,
          total: true, validUntil: true, sentAt: true, decidedAt: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.quotation.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

portalRouter.get(
  '/quotations/:id',
  requirePermission('portal.quotations.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const quotation = await prisma.quotation.findFirst({
      where: { id: req.params.id, clientId, status: { not: 'DRAFT' } },
      select: {
        id: true, quotationNo: true, title: true, status: true, currency: true,
        subtotal: true, discountTotal: true, taxRate: true, taxTotal: true, total: true,
        validUntil: true, clientNotes: true, terms: true, sentAt: true, decidedAt: true, rejectionReason: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!quotation) throw new AppError('Quotation not found', 404);
    return sendSuccess(res, quotation);
  }),
);

const respondSchema = z.object({
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  reason: z.string().trim().max(1000).nullable().optional(),
});

portalRouter.post(
  '/quotations/:id/respond',
  requirePermission('portal.quotations.respond'),
  validate(idParamSchema, 'params'),
  validate(respondSchema),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const data = req.body as z.infer<typeof respondSchema>;
    const quotation = await prisma.quotation.findFirst({ where: { id: req.params.id, clientId } });
    if (!quotation) throw new AppError('Quotation not found', 404);
    if (quotation.status !== 'SENT') {
      throw new AppError('This quotation is not open for a response', 409);
    }

    const updated = await prisma.quotation.update({
      where: { id: quotation.id },
      data: {
        status: data.decision as QuotationStatus,
        decidedAt: new Date(),
        rejectionReason: data.decision === 'REJECTED' ? data.reason ?? null : null,
      },
    });

    await logActivity({
      actorId: req.user!.id,
      action: `quotation.${data.decision.toLowerCase()}`,
      entityType: 'Quotation',
      entityId: quotation.id,
      clientId,
      summary: `Client ${data.decision === 'ACCEPTED' ? 'accepted' : 'rejected'} quotation ${quotation.quotationNo}`,
      isClientVisible: true,
    });
    await notifyPermissionHolders('quotations.view', {
      type: 'QUOTATION_APPROVAL',
      title: `Quotation ${data.decision.toLowerCase()}`,
      message: `${quotation.quotationNo} was ${data.decision.toLowerCase()} by the client`,
      entityType: 'Quotation',
      entityId: quotation.id,
      link: `/quotations/${quotation.id}`,
      dedupeKey: `quotation-response:${quotation.id}:${data.decision}`,
    });
    await writeAudit(req, { action: `portal.quotation.${data.decision.toLowerCase()}`, module: 'portal', entityId: quotation.id });

    return sendSuccess(res, updated, { message: `Quotation ${data.decision.toLowerCase()}` });
  }),
);

/* ---------------------------------- Tickets -------------------------------- */

portalRouter.get(
  '/tickets',
  requirePermission('portal.tickets.view'),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const query = parseListQuery(req);
    const where: Prisma.TicketWhereInput = {
      clientId,
      ...(req.query.status ? { status: String(req.query.status) as TicketStatus } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        select: {
          id: true, ticketNo: true, subject: true, category: true, priority: true, status: true,
          createdAt: true, updatedAt: true, resolvedAt: true, closedAt: true,
          _count: { select: { messages: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.ticket.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

const ticketCreateSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(10000),
  category: z.nativeEnum(TicketCategory).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  projectId: z.string().min(1).nullable().optional(),
});

portalRouter.post(
  '/tickets',
  requirePermission('portal.tickets.create'),
  validate(ticketCreateSchema),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const data = req.body as z.infer<typeof ticketCreateSchema>;

    if (data.projectId) {
      const project = await prisma.project.findFirst({ where: { id: data.projectId, clientId } });
      if (!project) throw new AppError('Project not found', 404);
    }

    const ticket = await prisma.$transaction(async (tx) => {
      const ticketNo = await numbering.ticketNumber(tx);
      return tx.ticket.create({
        data: {
          ticketNo,
          clientId,
          projectId: data.projectId ?? null,
          subject: data.subject,
          description: data.description,
          category: data.category ?? 'GENERAL',
          priority: data.priority ?? 'MEDIUM',
          status: 'OPEN',
          createdById: req.user!.id,
        },
      });
    });

    await notifyPermissionHolders('tickets.viewAll', {
      type: 'TICKET_CREATED',
      title: 'New support ticket',
      message: `${ticket.ticketNo}: ${ticket.subject}`,
      entityType: 'Ticket',
      entityId: ticket.id,
      link: `/tickets/${ticket.id}`,
      dedupeKey: `ticket-created:${ticket.id}`,
    }, { discordEvent: 'ticket.created' });
    await writeAudit(req, { action: 'portal.ticket.create', module: 'portal', entityId: ticket.id });

    return sendCreated(res, ticket, 'Support ticket submitted');
  }),
);

async function loadOwnedTicket(req: AuthRequest, id: string) {
  const clientId = requireClientId(req);
  const ticket = await prisma.ticket.findFirst({ where: { id, clientId } });
  if (!ticket) throw new AppError('Ticket not found', 404);
  return ticket;
}

portalRouter.get(
  '/tickets/:id',
  requirePermission('portal.tickets.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const ticket = await loadOwnedTicket(req, req.params.id);
    const full = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: {
        id: true, ticketNo: true, subject: true, description: true, category: true, priority: true,
        status: true, createdAt: true, updatedAt: true, resolvedAt: true, closedAt: true, resolutionSummary: true,
        assignedTo: { select: { firstName: true, lastName: true } },
        messages: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          select: { id: true, body: true, createdAt: true, author: { select: { firstName: true, lastName: true } } },
        },
        attachments: { where: { deletedAt: null, isClientVisible: true }, select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true } },
      },
    });
    return sendSuccess(res, full);
  }),
);

const messageSchema = z.object({ body: z.string().trim().min(1).max(10000) });

portalRouter.post(
  '/tickets/:id/messages',
  requirePermission('portal.tickets.update'),
  validate(idParamSchema, 'params'),
  validate(messageSchema),
  ah(async (req: AuthRequest, res) => {
    const ticket = await loadOwnedTicket(req, req.params.id);
    if (['CLOSED'].includes(ticket.status)) {
      throw new AppError('This ticket is closed and cannot receive new replies', 409);
    }
    const data = req.body as z.infer<typeof messageSchema>;

    const message = await prisma.ticketMessage.create({
      data: { ticketId: ticket.id, authorId: req.user!.id, body: data.body, isInternal: false },
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        lastReplyAt: new Date(),
        status: ticket.status === 'RESOLVED' ? 'IN_PROGRESS' : ticket.status,
      },
    });

    if (ticket.assignedToId) {
      await createNotification({
        userId: ticket.assignedToId,
        type: 'TICKET_REPLY',
        title: 'New client reply',
        message: `${ticket.ticketNo}: ${ticket.subject}`,
        entityType: 'Ticket',
        entityId: ticket.id,
        link: `/tickets/${ticket.id}`,
      });
    }
    return sendCreated(res, message, 'Reply sent');
  }),
);

// Clients may not edit tickets beyond replies; the portal exposes no update route.

/* ---------------------------------- Profile -------------------------------- */

portalRouter.get(
  '/profile',
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const [client, user] = await Promise.all([
      prisma.client.findUnique({
        where: { id: clientId },
        select: {
          id: true, companyName: true, firstName: true, lastName: true, email: true, phone: true,
          address: true, city: true, country: true, website: true, currency: true, createdAt: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { id: true, email: true, firstName: true, lastName: true, phone: true, avatarId: true, lastLogin: true },
      }),
    ]);
    return sendSuccess(res, { client, user });
  }),
);

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  companyName: z.string().trim().max(160).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  website: z.string().trim().max(255).nullable().optional(),
});

portalRouter.patch(
  '/profile',
  requirePermission('portal.profile.update'),
  validate(profileSchema),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const data = req.body as z.infer<typeof profileSchema>;

    const [client, user] = await prisma.$transaction(async (tx) => {
      const updatedClient = await tx.client.update({
        where: { id: clientId },
        data: {
          ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
          ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
          ...(data.companyName !== undefined ? { companyName: data.companyName } : {}),
          ...(data.address !== undefined ? { address: data.address } : {}),
          ...(data.city !== undefined ? { city: data.city } : {}),
          ...(data.country !== undefined ? { country: data.country } : {}),
          ...(data.website !== undefined ? { website: data.website } : {}),
        },
      });
      const updatedUser = await tx.user.update({
        where: { id: req.user!.id },
        data: {
          ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
          ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
          ...(data.phone !== undefined ? { phone: data.phone } : {}),
        },
      });
      return [updatedClient, updatedUser];
    });

    await writeAudit(req, { action: 'portal.profile.update', module: 'portal', entityId: client.id });
    return sendSuccess(res, {
      client,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone },
    }, { message: 'Profile updated' });
  }),
);

/* --------------------------------- Activity -------------------------------- */

portalRouter.get(
  '/activity',
  requirePermission('portal.projects.view'),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const activities = await prisma.activityLog.findMany({
      where: { clientId, isClientVisible: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, summary: true, entityType: true, createdAt: true },
    });
    return sendSuccess(res, activities);
  }),
);

/** Public-ish company profile for the portal header (no secrets). */
portalRouter.get(
  '/company',
  ah(async (_req: AuthRequest, res) => {
    const company = await getCompanyProfile();
    return sendSuccess(res, company);
  }),
);
