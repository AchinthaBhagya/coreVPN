import { Router } from 'express';
import { z } from 'zod';
import { LeadStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { logActivity } from '../services/activityService';
import { notifyPermissionHolders } from '../services/notificationService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, optionalMoneySchema, sendList } from './helpers';

export const leadsRouter = Router();

leadsRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'updatedAt', 'firstName', 'lastName', 'estimatedValue', 'status'];

const leadBodySchema = z.object({
  companyName: z.string().trim().max(160).nullable().optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().email(),
  phone: z.string().trim().max(40).nullable().optional(),
  website: z.string().trim().max(255).nullable().optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  source: z.string().trim().max(120).nullable().optional(),
  estimatedValue: optionalMoneySchema,
  currency: z.string().length(3).toUpperCase().optional(),
  serviceInterest: z.string().trim().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  assignedToId: z.string().min(1).nullable().optional(),
  lastContactAt: z.union([z.string(), z.date()]).nullable().optional(),
});

const leadUpdateSchema = leadBodySchema.partial();

const convertSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
  accountManagerId: z.string().min(1).nullable().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  status: z.enum(['PROSPECT', 'ACTIVE']).optional(),
});

leadsRouter.get(
  '/',
  requirePermission('leads.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'createdAt');
    const where: Prisma.LeadWhereInput = {
      ...(query.search
        ? {
            OR: [
              { companyName: { contains: query.search } },
              { firstName: { contains: query.search } },
              { lastName: { contains: query.search } },
              { email: { contains: query.search } },
            ],
          }
        : {}),
      ...(req.query.status ? { status: String(req.query.status) as LeadStatus } : {}),
      ...(req.query.assignedToId ? { assignedToId: String(req.query.assignedToId) } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.lead.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

leadsRouter.post(
  '/',
  requirePermission('leads.create'),
  validate(leadBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof leadBodySchema>;
    const lead = await prisma.lead.create({
      data: {
        companyName: data.companyName ?? null,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email.toLowerCase(),
        phone: data.phone ?? null,
        website: data.website ?? null,
        status: data.status ?? 'NEW',
        source: data.source ?? null,
        estimatedValue: data.estimatedValue ?? null,
        currency: data.currency ?? 'LKR',
        serviceInterest: data.serviceInterest ?? null,
        notes: data.notes ?? null,
        assignedToId: data.assignedToId ?? null,
        lastContactAt: data.lastContactAt ? new Date(data.lastContactAt) : null,
      },
    });
    await notifyPermissionHolders('leads.view', {
      type: 'LEAD_NEW',
      title: 'New lead captured',
      message: `${lead.companyName || `${lead.firstName} ${lead.lastName}`} (${lead.email})`,
      entityType: 'Lead',
      entityId: lead.id,
      link: `/leads/${lead.id}`,
      dedupeKey: `lead-new:${lead.id}`,
    }, { discordEvent: 'lead.new' });
    return sendCreated(res, lead, 'Lead created successfully');
  }),
);

leadsRouter.get(
  '/:id',
  requirePermission('leads.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!lead) throw new AppError('Lead not found', 404);
    return sendSuccess(res, lead);
  }),
);

leadsRouter.patch(
  '/:id',
  requirePermission('leads.update'),
  validate(idParamSchema, 'params'),
  validate(leadUpdateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof leadUpdateSchema>;
    const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Lead not found', 404);

    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data: {
        ...(data.companyName !== undefined ? { companyName: data.companyName } : {}),
        ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
        ...(data.email !== undefined ? { email: data.email.toLowerCase() } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.website !== undefined ? { website: data.website } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.source !== undefined ? { source: data.source } : {}),
        ...(data.estimatedValue !== undefined ? { estimatedValue: data.estimatedValue } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.serviceInterest !== undefined ? { serviceInterest: data.serviceInterest } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.assignedToId !== undefined ? { assignedToId: data.assignedToId } : {}),
        ...(data.lastContactAt !== undefined
          ? { lastContactAt: data.lastContactAt ? new Date(data.lastContactAt) : null }
          : {}),
      },
    });
    return sendSuccess(res, lead, { message: 'Lead updated successfully' });
  }),
);

leadsRouter.delete(
  '/:id',
  requirePermission('leads.delete'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Lead not found', 404);
    await prisma.lead.delete({ where: { id: existing.id } });
    await writeAudit(req, { action: 'lead.delete', module: 'leads', entityId: existing.id });
    return sendNoContent(res);
  }),
);

/** Converts a qualified lead into a client record. */
leadsRouter.post(
  '/:id/convert',
  requirePermission('leads.convert'),
  validate(idParamSchema, 'params'),
  validate(convertSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof convertSchema>;
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) throw new AppError('Lead not found', 404);
    if (lead.convertedClientId) throw new AppError('This lead has already been converted', 409);

    const client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          type: data.type ?? (lead.companyName ? 'BUSINESS' : 'INDIVIDUAL'),
          companyName: lead.companyName,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          website: lead.website,
          status: data.status ?? 'ACTIVE',
          leadSource: lead.source,
          notes: lead.notes,
          currency: data.currency ?? lead.currency,
          accountManagerId: data.accountManagerId ?? lead.assignedToId ?? null,
          createdById: req.user!.id,
        },
      });
      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'WON', convertedClientId: created.id, convertedAt: new Date() },
      });
      return created;
    });

    await logActivity({
      actorId: req.user!.id,
      action: 'lead.converted',
      entityType: 'Client',
      entityId: client.id,
      clientId: client.id,
      summary: `Lead converted to client ${client.companyName || `${client.firstName} ${client.lastName}`}`,
    });
    await writeAudit(req, { action: 'lead.convert', module: 'leads', entityId: lead.id, details: { clientId: client.id } });
    return sendCreated(res, client, 'Lead converted to client');
  }),
);
