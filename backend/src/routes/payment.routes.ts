import { Router } from 'express';
import { z } from 'zod';
import { PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { logActivity } from '../services/activityService';
import { notifyPermissionHolders } from '../services/notificationService';
import { numbering } from '../services/numberingService';
import { recalculateInvoice } from '../services/financeService';
import { dec, sub } from '../utils/money';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, moneySchema, sendList } from './helpers';

export const paymentsRouter = Router();

paymentsRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'paidAt', 'amount', 'method'];

const paymentBodySchema = z.object({
  invoiceId: z.string().min(1).nullable().optional(),
  clientId: z.string().min(1).nullable().optional(),
  amount: moneySchema,
  currency: z.string().length(3).toUpperCase().optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  paidAt: z.union([z.string(), z.date()]).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const voidSchema = z.object({ reason: z.string().trim().min(3).max(500) });

paymentsRouter.get(
  '/',
  requirePermission('payments.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'paidAt');
    const where: Prisma.PaymentWhereInput = {
      ...(req.query.clientId ? { clientId: String(req.query.clientId) } : {}),
      ...(req.query.invoiceId ? { invoiceId: String(req.query.invoiceId) } : {}),
      ...(req.query.method ? { method: String(req.query.method) as PaymentMethod } : {}),
      ...(req.query.includeVoid === 'true' ? {} : { isVoid: false }),
      ...(query.dateFrom || query.dateTo
        ? { paidAt: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lte: query.dateTo } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true, firstName: true, lastName: true } },
          invoice: { select: { id: true, invoiceNo: true } },
          recordedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.payment.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

paymentsRouter.post(
  '/',
  requirePermission('payments.record'),
  validate(paymentBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof paymentBodySchema>;
    const amount = dec(data.amount);
    if (!amount.greaterThan(0)) throw new AppError('Payment amount must be greater than zero', 422);

    let clientId = data.clientId ?? null;
    let currency = data.currency ?? 'LKR';
    let invoice = null as Awaited<ReturnType<typeof prisma.invoice.findUnique>> | null;

    if (data.invoiceId) {
      invoice = await prisma.invoice.findUnique({ where: { id: data.invoiceId } });
      if (!invoice) throw new AppError('Invoice not found', 404);
      if (invoice.status === 'VOID') throw new AppError('Cannot record a payment against a void invoice', 409);
      if (invoice.status === 'DRAFT') throw new AppError('Issue the invoice before recording payments', 409);
      clientId = invoice.clientId;
      currency = invoice.currency;

      const outstanding = sub(invoice.total, invoice.amountPaid);
      if (amount.greaterThan(outstanding)) {
        throw new AppError(
          `Payment exceeds the outstanding balance of ${invoice.currency} ${outstanding.toFixed(2)}`,
          422,
        );
      }
    }

    if (!clientId) throw new AppError('A client or invoice is required', 422);
    const client = await prisma.client.findFirst({ where: { id: clientId, deletedAt: null } });
    if (!client) throw new AppError('Client not found', 404);
    if (!data.currency) currency = client.currency;

    const payment = await prisma.$transaction(async (tx) => {
      const paymentNo = await numbering.paymentNumber(tx);
      return tx.payment.create({
        data: {
          paymentNo,
          invoiceId: data.invoiceId ?? null,
          clientId: client.id,
          amount,
          currency,
          method: data.method ?? 'BANK_TRANSFER',
          reference: data.reference ?? null,
          paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
          notes: data.notes ?? null,
          recordedById: req.user!.id,
        },
      });
    });

    // Recomputes amountPaid/balance and settlement status from confirmed payments.
    if (payment.invoiceId) await recalculateInvoice(payment.invoiceId);

    await logActivity({
      actorId: req.user!.id,
      action: 'payment.recorded',
      entityType: 'Payment',
      entityId: payment.id,
      clientId: payment.clientId,
      projectId: invoice?.projectId ?? null,
      summary: `Payment ${payment.paymentNo} of ${currency} ${amount.toFixed(2)} recorded`,
      isClientVisible: true,
    });
    await notifyPermissionHolders('payments.view', {
      type: 'PAYMENT_RECORDED',
      title: 'Payment recorded',
      message: `${payment.paymentNo} • ${currency} ${amount.toFixed(2)}`,
      entityType: 'Payment',
      entityId: payment.id,
      link: `/payments/${payment.id}`,
      dedupeKey: `payment-recorded:${payment.id}`,
    }, { discordEvent: 'payment.recorded' });
    await writeAudit(req, {
      action: 'payment.record',
      module: 'payments',
      entityId: payment.id,
      details: { amount: amount.toFixed(2), currency },
    });

    return sendCreated(res, payment, 'Payment recorded');
  }),
);

paymentsRouter.get(
  '/:id',
  requirePermission('payments.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        invoice: { select: { id: true, invoiceNo: true, total: true, balance: true, status: true } },
        recordedBy: { select: { firstName: true, lastName: true } },
        refunds: true,
      },
    });
    if (!payment) throw new AppError('Payment not found', 404);
    return sendSuccess(res, payment);
  }),
);

paymentsRouter.post(
  '/:id/void',
  requirePermission('payments.void'),
  validate(idParamSchema, 'params'),
  validate(voidSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof voidSchema>;
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment) throw new AppError('Payment not found', 404);
    if (payment.isVoid) throw new AppError('Payment is already void', 409);

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { isVoid: true, voidReason: data.reason },
    });
    if (payment.invoiceId) await recalculateInvoice(payment.invoiceId);
    await writeAudit(req, { action: 'payment.void', module: 'payments', entityId: payment.id, details: { reason: data.reason } });
    return sendSuccess(res, updated, { message: 'Payment voided' });
  }),
);
