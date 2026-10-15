import { Router } from 'express';
import { z } from 'zod';
import { AllocationModel, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { sendSuccess } from '../utils/apiResponse';
import { sendCsv } from '../utils/csv';
import { writeAudit } from '../utils/audit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { denyClients, requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField, parseDate } from '../utils/pagination';
import { ah, sendList } from './helpers';

export const settingsRouter = Router();

settingsRouter.use(authenticate, denyClients());

const COMPANY_ID = 'default';

const companySchema = z.object({
  companyName: z.string().trim().min(1).max(200).optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  website: z.string().trim().max(255).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  taxId: z.string().trim().max(80).nullable().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  secondaryCurrency: z.string().length(3).toUpperCase().nullable().optional(),
  exchangeRate: z.union([z.number(), z.string()]).nullable().optional(),
  timezone: z.string().trim().max(64).optional(),
  dateFormat: z.string().trim().max(40).optional(),
  numberFormat: z.string().trim().max(40).optional(),
});

const systemSchema = z.object({
  invoicePrefix: z.string().trim().min(1).max(20).optional(),
  quotationPrefix: z.string().trim().min(1).max(20).optional(),
  orderPrefix: z.string().trim().min(1).max(20).optional(),
  projectPrefix: z.string().trim().min(1).max(20).optional(),
  taxRate: z.union([z.number(), z.string()]).optional(),
  defaultAllocationModel: z.nativeEnum(AllocationModel).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  maintenanceMode: z.boolean().optional(),
});

async function loadCompany() {
  const existing = await prisma.companySetting.findUnique({ where: { id: COMPANY_ID } });
  if (existing) return existing;
  return prisma.companySetting.create({ data: { id: COMPANY_ID } });
}

settingsRouter.get(
  '/company',
  requirePermission('settings.view'),
  ah(async (_req: AuthRequest, res) => {
    const company = await loadCompany();
    return sendSuccess(res, company);
  }),
);

settingsRouter.put(
  '/company',
  requirePermission('settings.company'),
  validate(companySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof companySchema>;
    await loadCompany();
    const company = await prisma.companySetting.update({
      where: { id: COMPANY_ID },
      data: {
        ...(data.companyName !== undefined ? { companyName: data.companyName } : {}),
        ...(data.legalName !== undefined ? { legalName: data.legalName } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.website !== undefined ? { website: data.website } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.taxId !== undefined ? { taxId: data.taxId } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.secondaryCurrency !== undefined ? { secondaryCurrency: data.secondaryCurrency } : {}),
        ...(data.exchangeRate !== undefined
          ? { exchangeRate: data.exchangeRate === null || data.exchangeRate === '' ? null : String(data.exchangeRate) }
          : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        ...(data.dateFormat !== undefined ? { dateFormat: data.dateFormat } : {}),
        ...(data.numberFormat !== undefined ? { numberFormat: data.numberFormat } : {}),
      },
    });
    await writeAudit(req, { action: 'settings.company.update', module: 'settings' });
    return sendSuccess(res, company, { message: 'Company settings saved' });
  }),
);

settingsRouter.get(
  '/system',
  requirePermission('settings.view'),
  ah(async (_req: AuthRequest, res) => {
    const company = await loadCompany();
    return sendSuccess(res, {
      invoicePrefix: company.invoicePrefix,
      quotationPrefix: company.quotationPrefix,
      orderPrefix: company.orderPrefix,
      projectPrefix: company.projectPrefix,
      taxRate: company.taxRate,
      defaultAllocationModel: company.defaultAllocationModel,
      paymentTermsDays: company.paymentTermsDays,
      maintenanceMode: company.maintenanceMode,
      timezone: company.timezone,
      dateFormat: company.dateFormat,
      numberFormat: company.numberFormat,
      runtime: {
        nodeEnv: env.nodeEnv,
        uploadDir: env.uploadDir,
        maxFileSizeMb: env.maxFileSizeMb,
        sessionTtlHours: env.sessionTtlHours,
        discordEnabled: env.discord.enabled,
      },
    });
  }),
);

settingsRouter.put(
  '/system',
  requirePermission('settings.system'),
  validate(systemSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof systemSchema>;
    await loadCompany();
    const company = await prisma.companySetting.update({
      where: { id: COMPANY_ID },
      data: {
        ...(data.invoicePrefix !== undefined ? { invoicePrefix: data.invoicePrefix } : {}),
        ...(data.quotationPrefix !== undefined ? { quotationPrefix: data.quotationPrefix } : {}),
        ...(data.orderPrefix !== undefined ? { orderPrefix: data.orderPrefix } : {}),
        ...(data.projectPrefix !== undefined ? { projectPrefix: data.projectPrefix } : {}),
        ...(data.taxRate !== undefined ? { taxRate: String(data.taxRate) } : {}),
        ...(data.defaultAllocationModel !== undefined ? { defaultAllocationModel: data.defaultAllocationModel } : {}),
        ...(data.paymentTermsDays !== undefined ? { paymentTermsDays: data.paymentTermsDays } : {}),
        ...(data.maintenanceMode !== undefined ? { maintenanceMode: data.maintenanceMode } : {}),
      },
    });
    await writeAudit(req, {
      action: 'settings.system.update',
      module: 'settings',
      details: { maintenanceMode: company.maintenanceMode },
    });
    return sendSuccess(res, company, { message: 'System settings saved' });
  }),
);

/** Aggregate bootstrap payload used by the settings screens. */
settingsRouter.get(
  '/',
  requirePermission('settings.view'),
  ah(async (_req: AuthRequest, res) => {
    const company = await loadCompany();
    return sendSuccess(res, { company });
  }),
);

/* --------------------------------- Audit log ------------------------------- */

const SORTABLE = ['createdAt', 'action', 'module'];

settingsRouter.get(
  '/audit',
  requirePermission('audit.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'createdAt');
    const from = parseDate(req.query.dateFrom);
    const to = parseDate(req.query.dateTo);

    const where: Prisma.AuditLogWhereInput = {
      ...(req.query.module ? { module: String(req.query.module) } : {}),
      ...(req.query.action ? { action: String(req.query.action) } : {}),
      ...(req.query.userId ? { userId: String(req.query.userId) } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(query.search
        ? { OR: [{ action: { contains: query.search } }, { module: { contains: query.search } }] }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

settingsRouter.get(
  '/audit/export',
  requirePermission('audit.view'),
  ah(async (req: AuthRequest, res) => {
    const from = parseDate(req.query.dateFrom);
    const to = parseDate(req.query.dateTo);
    const logs = await prisma.auditLog.findMany({
      where: {
        ...(req.query.module ? { module: String(req.query.module) } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    return sendCsv(res, `audit-${new Date().toISOString().slice(0, 10)}.csv`, logs, [
      { header: 'Timestamp', value: (row) => row.createdAt },
      { header: 'User', value: (row) => row.user?.email ?? 'system' },
      { header: 'Module', value: (row) => row.module },
      { header: 'Action', value: (row) => row.action },
      { header: 'Entity', value: (row) => row.entityId ?? '' },
      { header: 'IP', value: (row) => row.ipAddress ?? '' },
      { header: 'Details', value: (row) => row.details ?? '' },
    ]);
  }),
);
