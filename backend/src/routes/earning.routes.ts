import { Router } from 'express';
import { z } from 'zod';
import { EarningStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { add, ZERO } from '../utils/money';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery } from '../utils/pagination';
import { ah, idParamSchema, sendList } from './helpers';

export const earningsRouter = Router();

earningsRouter.use(authenticate, denyClients());

const voidSchema = z.object({ reason: z.string().max(1000).nullable().optional() });

earningsRouter.get(
  '/',
  requirePermission('earnings.viewAll'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const where: Prisma.MemberEarningWhereInput = {
      ...(req.query.status ? { status: String(req.query.status) as EarningStatus } : {}),
      ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}),
      ...(req.query.userId ? { userId: String(req.query.userId) } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.memberEarning.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true, projectNo: true } },
          rule: { select: { id: true, name: true, version: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.memberEarning.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

earningsRouter.get(
  '/mine',
  requirePermission('earnings.viewOwn'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const where: Prisma.MemberEarningWhereInput = {
      userId: req.user!.id,
      ...(req.query.status ? { status: String(req.query.status) as EarningStatus } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.memberEarning.findMany({
        where,
        include: { project: { select: { id: true, name: true, projectNo: true } } },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.memberEarning.count({ where }),
    ]);

    return sendList(res, items, total, query.page, query.limit);
  }),
);

/** Aggregate view of the caller's earnings (accrued / paid / pending). */
earningsRouter.get(
  '/summary',
  requirePermission('earnings.viewOwn'),
  ah(async (req: AuthRequest, res) => {
    const rows = await prisma.memberEarning.groupBy({
      by: ['status'],
      _sum: { amount: true },
      where: { userId: req.user!.id },
    });
    const totals: Record<string, string> = {};
    for (const row of rows) totals[row.status] = (row._sum.amount ?? ZERO).toFixed(2);
    const accrued = rows
      .filter((row) => row.status !== 'VOID')
      .reduce((acc, row) => add(acc, row._sum.amount ?? ZERO), ZERO);

    const payouts = await prisma.memberPayout.groupBy({
      by: ['status'],
      _sum: { amount: true },
      where: { userId: req.user!.id },
    });
    const paidOut = payouts
      .filter((row) => row.status === 'PAID')
      .reduce((acc, row) => add(acc, row._sum.amount ?? ZERO), ZERO);

    return sendSuccess(res, {
      currency: 'LKR',
      byStatus: totals,
      accrued: accrued.toFixed(2),
      paidOut: paidOut.toFixed(2),
      outstanding: accrued.minus(paidOut).toFixed(2),
    });
  }),
);

earningsRouter.post(
  '/:id/approve',
  requirePermission('allocations.approve'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.memberEarning.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Earning not found', 404);
    if (existing.status === 'PAID') throw new AppError('Paid earnings cannot be changed', 409);
    const earning = await prisma.memberEarning.update({
      where: { id: existing.id },
      data: { status: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date() },
    });
    await writeAudit(req, { action: 'earning.approve', module: 'earnings', entityId: earning.id });
    return sendSuccess(res, earning, { message: 'Earning approved' });
  }),
);

earningsRouter.post(
  '/:id/void',
  requirePermission('allocations.approve'),
  validate(idParamSchema, 'params'),
  validate(voidSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof voidSchema>;
    const existing = await prisma.memberEarning.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Earning not found', 404);
    if (existing.status === 'PAID') throw new AppError('Paid earnings cannot be voided', 409);
    const earning = await prisma.memberEarning.update({
      where: { id: existing.id },
      data: { status: 'VOID', notes: data.reason ?? null },
    });
    await writeAudit(req, { action: 'earning.void', module: 'earnings', entityId: earning.id });
    return sendSuccess(res, earning, { message: 'Earning voided' });
  }),
);
