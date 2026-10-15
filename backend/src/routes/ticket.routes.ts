import { Router } from 'express';
import { z } from 'zod';
import { Prisma, TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { createNotification, notifyPermissionHolders } from '../services/notificationService';
import { numbering } from '../services/numberingService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, sendList } from './helpers';

export const ticketsRouter = Router();

ticketsRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'updatedAt', 'ticketNo', 'priority', 'status'];

const ticketBodySchema = z.object({
  clientId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(10000),
  category: z.nativeEnum(TicketCategory).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedToId: z.string().min(1).nullable().optional(),
});

const ticketUpdateSchema = ticketBodySchema.partial().extend({
  status: z.nativeEnum(TicketStatus).optional(),
  resolutionSummary: z.string().max(5000).nullable().optional(),
});

const messageSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  isInternal: z.boolean().optional(),
});

async function loadTicketForUser(req: AuthRequest, id: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw new AppError('Ticket not found', 404);
  if (!req.user!.permissions.includes('tickets.viewAll') && ticket.createdById !== req.user!.id && ticket.assignedToId !== req.user!.id) {
    throw new AppError('Ticket not found', 404);
  }
  return ticket;
}

ticketsRouter.get(
  '/',
  requirePermission('tickets.viewAll'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'createdAt');
    const where: Prisma.TicketWhereInput = {
      ...(query.search ? { OR: [{ ticketNo: { contains: query.search } }, { subject: { contains: query.search } }] } : {}),
      ...(req.query.status ? { status: String(req.query.status) as TicketStatus } : {}),
      ...(req.query.priority ? { priority: String(req.query.priority) as TicketPriority } : {}),
      ...(req.query.clientId ? { clientId: String(req.query.clientId) } : {}),
      ...(req.query.assignedToId ? { assignedToId: String(req.query.assignedToId) } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true, firstName: true, lastName: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.ticket.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

ticketsRouter.get(
  '/mine',
  requirePermission('tickets.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const where: Prisma.TicketWhereInput = { OR: [{ createdById: req.user!.id }, { assignedToId: req.user!.id }] };
    const [items, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: { client: { select: { companyName: true, firstName: true, lastName: true } } },
        orderBy: { updatedAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.ticket.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

ticketsRouter.post(
  '/',
  requirePermission('tickets.create'),
  validate(ticketBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof ticketBodySchema>;
    const client = await prisma.client.findFirst({ where: { id: data.clientId, deletedAt: null } });
    if (!client) throw new AppError('Client not found', 404);

    const ticket = await prisma.$transaction(async (tx) => {
      const ticketNo = await numbering.ticketNumber(tx);
      return tx.ticket.create({
        data: {
          ticketNo,
          clientId: client.id,
          projectId: data.projectId ?? null,
          subject: data.subject,
          description: data.description,
          category: data.category ?? 'GENERAL',
          priority: data.priority ?? 'MEDIUM',
          status: 'OPEN',
          assignedToId: data.assignedToId ?? null,
          createdById: req.user!.id,
        },
      });
    });

    if (ticket.assignedToId) {
      await createNotification({
        userId: ticket.assignedToId,
        type: 'TICKET_CREATED',
        title: 'Ticket assigned to you',
        message: `${ticket.ticketNo}: ${ticket.subject}`,
        entityType: 'Ticket',
        entityId: ticket.id,
        link: `/tickets/${ticket.id}`,
        dedupeKey: `ticket-assigned:${ticket.id}`,
      });
    }
    await notifyPermissionHolders('tickets.viewAll', {
      type: 'TICKET_CREATED',
      title: 'New support ticket',
      message: `${ticket.ticketNo}: ${ticket.subject}`,
      entityType: 'Ticket',
      entityId: ticket.id,
      link: `/tickets/${ticket.id}`,
      dedupeKey: `ticket-created:${ticket.id}`,
    }, { discordEvent: 'ticket.created' });
    return sendCreated(res, ticket);
  }),
);

ticketsRouter.get(
  '/:id',
  requirePermission('tickets.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    await loadTicketForUser(req, req.params.id);
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: {
        client: { select: { id: true, companyName: true, firstName: true, lastName: true, email: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        messages: {
          where: { isInternal: false },
          include: { author: { select: { firstName: true, lastName: true } }, attachments: { where: { deletedAt: null } } },
          orderBy: { createdAt: 'asc' },
        },
        attachments: { where: { deletedAt: null } },
      },
    });
    return sendSuccess(res, ticket);
  }),
);

ticketsRouter.patch(
  '/:id',
  requirePermission('tickets.update'),
  validate(idParamSchema, 'params'),
  validate(ticketUpdateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof ticketUpdateSchema>;
    const existing = await prisma.ticket.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Ticket not found', 404);

    const ticket = await prisma.ticket.update({
      where: { id: existing.id },
      data: {
        ...(data.subject !== undefined ? { subject: data.subject } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.assignedToId !== undefined ? { assignedToId: data.assignedToId } : {}),
        ...(data.resolutionSummary !== undefined ? { resolutionSummary: data.resolutionSummary } : {}),
        ...(data.status !== undefined
          ? {
              status: data.status,
              resolvedAt: data.status === 'RESOLVED' ? new Date() : existing.resolvedAt,
              closedAt: data.status === 'CLOSED' ? new Date() : existing.closedAt,
            }
          : {}),
      },
    });
    return sendSuccess(res, ticket, { message: 'Ticket updated' });
  }),
);

ticketsRouter.post(
  '/:id/assign',
  requirePermission('tickets.assign'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const assigneeId = req.body?.assignedToId ? String(req.body.assignedToId) : null;
    const existing = await prisma.ticket.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Ticket not found', 404);
    if (assigneeId) {
      const user = await prisma.user.findFirst({ where: { id: assigneeId, deletedAt: null } });
      if (!user) throw new AppError('Assignee not found', 404);
    }
    const ticket = await prisma.ticket.update({
      where: { id: existing.id },
      data: { assignedToId: assigneeId, status: existing.status === 'OPEN' ? 'IN_PROGRESS' : existing.status },
    });
    if (assigneeId) {
      await createNotification({
        userId: assigneeId,
        type: 'TICKET_CREATED',
        title: 'Ticket assigned',
        message: `${ticket.ticketNo}: ${ticket.subject}`,
        entityType: 'Ticket',
        entityId: ticket.id,
        link: `/tickets/${ticket.id}`,
        dedupeKey: `ticket-assign:${ticket.id}:${assigneeId}:${Date.now()}`,
      });
    }
    return sendSuccess(res, ticket, { message: 'Ticket assigned' });
  }),
);

ticketsRouter.post(
  '/:id/messages',
  requirePermission('tickets.update'),
  validate(idParamSchema, 'params'),
  validate(messageSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof messageSchema>;
    const ticket = await loadTicketForUser(req, req.params.id);

    const message = await prisma.ticketMessage.create({
      data: { ticketId: ticket.id, authorId: req.user!.id, body: data.body, isInternal: data.isInternal ?? false },
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        lastReplyAt: new Date(),
        firstResponseAt: ticket.firstResponseAt ?? new Date(),
        status: ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status,
      },
    });

    if (ticket.createdById && ticket.createdById !== req.user!.id) {
      await createNotification({
        userId: ticket.createdById,
        type: 'TICKET_REPLY',
        title: 'New reply on a ticket',
        message: `${ticket.ticketNo}: ${ticket.subject}`,
        entityType: 'Ticket',
        entityId: ticket.id,
        link: `/tickets/${ticket.id}`,
      });
    }
    return sendCreated(res, message);
  }),
);

ticketsRouter.post(
  '/:id/resolve',
  requirePermission('tickets.close'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const ticket = await loadTicketForUser(req, req.params.id);
    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolutionSummary: req.body?.resolutionSummary ? String(req.body.resolutionSummary) : ticket.resolutionSummary,
      },
    });
    await writeAudit(req, { action: 'ticket.resolve', module: 'tickets', entityId: ticket.id });
    return sendSuccess(res, updated, { message: 'Ticket resolved' });
  }),
);
