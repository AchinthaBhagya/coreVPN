import { Router } from 'express';
import { z } from 'zod';
import { PaymentMethod, PayoutStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { numbering } from '../services/numberingService';
import { add, dec, round, ZERO } from '../utils/money';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery } from '../utils/pagination';
import { ah, idParamSchema, sendList } from './helpers';

export const payoutsRouter = Router();

payoutsRouter.use(authenticate, denyClients());

const createSchema = z.object({
  userId: z.string().min(1),
  earningIds: z.array(z.string().min(1)).min(1, 'Select at least one earning'),
  method: z.nativeEnum(PaymentMethod).optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  submitForApproval: z.boolean().optional(),
});

const cancelSchema = z.object({ reason: z.string().max(1000).nullable().optional() });

payoutsRouter.get(
  '/',
  requirePermission('payouts.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const where: Prisma.MemberPayoutWhereInput = {
      ...(req.query.status ? { status: String(req.query.status) as PayoutStatus } : {}),
      ...(req.query.userId ? { userId: String(req.query.userId) } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.memberPayout.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.memberPayout.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

/** The caller's own payouts (available to members with earnings.viewOwn). */
payoutsRouter.get(
  '/mine',
  requirePermission('earnings.viewOwn'),
  ah(async (req: AuthRequest, res) => {
    const payouts = await prisma.memberPayout.findMany({
      where: { userId: req.user!.id },
      include: { items: { include: { earning: { include: { project: { select: { name: true, projectNo: true } } } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return sendSuccess(res, payouts);
  }),
);

payoutsRouter.get(
  '/:id',
  requirePermission('payouts.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const payout = await prisma.memberPayout.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        items: { include: { earning: { include: { project: { select: { id: true, name: true, projectNo: true } } } } } },
      },
    });
    if (!payout) throw new AppError('Payout not found', 404);
    return sendSuccess(res, payout);
  }),
);

payoutsRouter.post(
  '/',
  requirePermission('payouts.manage'),
  validate(createSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof createSchema>;
    const user = await prisma.user.findFirst({ where: { id: data.userId, deletedAt: null } });
    if (!user) throw new AppError('User not found', 404);

    const earnings = await prisma.memberEarning.findMany({
      where: { id: { in: data.earningIds }, userId: user.id },
      include: { payoutItems: true },
    });
    if (earnings.length !== data.earningIds.length) {
      throw new AppError('One or more earnings were not found for this member', 422);
    }
    const alreadyPaid = earnings.filter((e) => e.status === 'PAID' || e.payoutItems.length > 0);
    if (alreadyPaid.length) throw new AppError('Some selected earnings are already part of a payout', 409);

    const total = round(earnings.reduce<Prisma.Decimal>((acc, e) => add(acc, e.amount), ZERO));
    if (!dec(total).greaterThan(0)) throw new AppError('The payout total must be greater than zero', 422);

    const payout = await prisma.$transaction(async (tx) => {
      const payoutNo = await numbering.payoutNumber(tx);
      return tx.memberPayout.create({
        data: {
          payoutNo,
          userId: user.id,
          amount: total,
          currency: earnings[0].currency,
          method: data.method ?? 'BANK_TRANSFER',
          reference: data.reference ?? null,
          status: data.submitForApproval ? 'PENDING_APPROVAL' : 'DRAFT',
          notes: data.notes ?? null,
          createdById: req.user!.id,
          items: { create: earnings.map((e) => ({ earningId: e.id, amount: e.amount })) },
        },
        include: { items: true },
      });
    });

    await writeAudit(req, { action: 'payout.create', module: 'payouts', entityId: payout.id, details: { amount: total.toFixed(2) } });
    return sendCreated(res, payout, 'Payout created');
  }),
);

payoutsRouter.post(
  '/:id/approve',
  requirePermission('payouts.approve'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.memberPayout.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Payout not found', 404);
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(existing.status)) {
      throw new AppError('Only draft or pending payouts can be approved', 409);
    }
    // Separation of duties: entitlement is not a payout, and a payout is not
    // approved by the person it is paid to. Someone else with payouts.approve
    // has to sign it off.
    if (existing.userId === req.user!.id) {
      throw new AppError(
        'A payout cannot be approved by the member it is paid to - another approver with payouts.approve is required',
        403,
      );
    }
    const payout = await prisma.memberPayout.update({
      where: { id: existing.id },
      data: { status: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date() },
    });
    await writeAudit(req, { action: 'payout.approve', module: 'payouts', entityId: payout.id });
    return sendSuccess(res, payout, { message: 'Payout approved' });
  }),
);

payoutsRouter.post(
  '/:id/pay',
  requirePermission('payouts.approve'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.memberPayout.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!existing) throw new AppError('Payout not found', 404);
    if (existing.status !== 'APPROVED') throw new AppError('Approve the payout before marking it paid', 409);

    const payout = await prisma.$transaction(async (tx) => {
      await tx.memberEarning.updateMany({
        where: { id: { in: existing.items.map((i) => i.earningId) } },
        data: { status: 'PAID' },
      });
      return tx.memberPayout.update({
        where: { id: existing.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
    });
    await writeAudit(req, { action: 'payout.pay', module: 'payouts', entityId: payout.id });
    return sendSuccess(res, payout, { message: 'Payout marked paid' });
  }),
);

payoutsRouter.post(
  '/:id/cancel',
  requirePermission('payouts.manage'),
  validate(idParamSchema, 'params'),
  validate(cancelSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof cancelSchema>;
    const existing = await prisma.memberPayout.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Payout not found', 404);
    if (existing.status === 'PAID') throw new AppError('Paid payouts cannot be cancelled', 409);
    const payout = await prisma.memberPayout.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED', notes: data.reason ?? existing.notes },
    });
    await writeAudit(req, { action: 'payout.cancel', module: 'payouts', entityId: payout.id });
    return sendSuccess(res, payout, { message: 'Payout cancelled' });
  }),
);
