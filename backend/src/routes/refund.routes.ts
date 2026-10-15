import { Router } from 'express';
import { z } from 'zod';
import { Invoice, Payment, Prisma, RefundKind } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { numbering } from '../services/numberingService';
import { recalculateInvoice } from '../services/financeService';
import { dec } from '../utils/money';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery } from '../utils/pagination';
import { ah, idParamSchema, moneySchema, sendList } from './helpers';

export const refundsRouter = Router();

refundsRouter.use(authenticate, denyClients());

const refundBodySchema = z.object({
  kind: z.nativeEnum(RefundKind).optional(),
  paymentId: z.string().min(1).nullable().optional(),
  invoiceId: z.string().min(1).nullable().optional(),
  clientId: z.string().min(1).nullable().optional(),
  amount: moneySchema,
  currency: z.string().length(3).toUpperCase().optional(),
  reason: z.string().max(2000).nullable().optional(),
});

refundsRouter.get(
  '/',
  requirePermission('refunds.manage'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const where: Prisma.RefundWhereInput = {
      ...(req.query.clientId ? { clientId: String(req.query.clientId) } : {}),
      ...(req.query.invoiceId ? { invoiceId: String(req.query.invoiceId) } : {}),
      ...(req.query.kind ? { kind: String(req.query.kind) as RefundKind } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.refund.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true, firstName: true, lastName: true } },
          invoice: { select: { id: true, invoiceNo: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.refund.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

refundsRouter.post(
  '/',
  requirePermission('refunds.manage'),
  validate(refundBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof refundBodySchema>;
    const amount = dec(data.amount);
    if (!amount.greaterThan(0)) throw new AppError('Refund amount must be greater than zero', 422);

    let clientId = data.clientId ?? null;
    let currency = data.currency ?? 'LKR';
    let payment: Payment | null = null;
    let invoice: Invoice | null = null;

    if (data.paymentId) {
      const row = await prisma.payment.findUnique({ where: { id: data.paymentId } });
      if (!row) throw new AppError('Payment not found', 404);
      if (row.isVoid) throw new AppError('Cannot refund a void payment', 409);
      payment = row;
      clientId = row.clientId;
      currency = row.currency;
    }
    if (data.invoiceId) {
      const row = await prisma.invoice.findUnique({ where: { id: data.invoiceId } });
      if (!row) throw new AppError('Invoice not found', 404);
      invoice = row;
      clientId = clientId ?? row.clientId;
      currency = data.currency ?? row.currency;
    }
    if (!clientId) throw new AppError('A client, payment or invoice is required', 422);

    // Cash-received cap: amountPaid is recomputed as payments - refunds, so a
    // refund can never exceed the cash actually collected for the payment (or,
    // when no payment is given, for the invoice as a whole). Without this the
    // invoice's amountPaid would go negative.
    if (payment) {
      const alreadyRefunded = await prisma.refund.aggregate({
        where: { paymentId: payment.id, currency: payment.currency },
        _sum: { amount: true },
      });
      const remaining = dec(payment.amount).minus(alreadyRefunded._sum.amount ?? 0);
      if (amount.greaterThan(remaining)) {
        throw new AppError(
          `Refund exceeds the cash received on this payment (maximum ${remaining.toFixed(2)} ${payment.currency})`,
          422,
        );
      }
    } else if (invoice) {
      const [collected, alreadyRefunded] = await Promise.all([
        prisma.payment.aggregate({
          where: { invoiceId: invoice.id, currency: invoice.currency, isVoid: false },
          _sum: { amount: true },
        }),
        prisma.refund.aggregate({
          where: { invoiceId: invoice.id, currency: invoice.currency },
          _sum: { amount: true },
        }),
      ]);
      const remaining = dec(collected._sum.amount ?? 0).minus(alreadyRefunded._sum.amount ?? 0);
      if (amount.greaterThan(remaining)) {
        throw new AppError(
          `Refund exceeds the cash received on this invoice (maximum ${remaining.toFixed(2)} ${invoice.currency})`,
          422,
        );
      }
    }

    const refund = await prisma.$transaction(async (tx) => {
      const refundNo = await numbering.refundNumber(tx);
      return tx.refund.create({
        data: {
          refundNo,
          kind: data.kind ?? 'REFUND',
          paymentId: data.paymentId ?? null,
          invoiceId: data.invoiceId ?? null,
          clientId,
          amount,
          currency,
          reason: data.reason ?? null,
          createdById: req.user!.id,
        },
      });
    });

    if (refund.invoiceId) await recalculateInvoice(refund.invoiceId);
    await writeAudit(req, {
      action: 'refund.create',
      module: 'refunds',
      entityId: refund.id,
      details: { kind: refund.kind, amount: amount.toFixed(2), currency },
    });
    return sendCreated(res, refund, 'Refund / credit note recorded');
  }),
);

refundsRouter.get(
  '/:id',
  requirePermission('refunds.manage'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const refund = await prisma.refund.findUnique({
      where: { id: req.params.id },
      include: { client: true, invoice: { select: { id: true, invoiceNo: true } }, payment: true },
    });
    if (!refund) throw new AppError('Refund not found', 404);
    return sendSuccess(res, refund);
  }),
);
