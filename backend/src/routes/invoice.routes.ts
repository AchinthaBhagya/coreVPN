import { Router } from 'express';
import { z } from 'zod';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { logActivity } from '../services/activityService';
import { notifyPermissionHolders } from '../services/notificationService';
import { invoiceEmail, sendMail } from '../services/emailService';
import { numbering } from '../services/numberingService';
import { computeDocumentTotals, LineItemInput } from '../services/financeService';
import { generateInvoicePdf } from '../services/pdfService';
import { formatMoney } from '../utils/money';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, lineItemSchema, sendList } from './helpers';

export const invoicesRouter = Router();

invoicesRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'updatedAt', 'invoiceNo', 'issueDate', 'dueDate', 'total', 'balance', 'status'];

const invoiceBodySchema = z.object({
  clientId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  orderId: z.string().min(1).nullable().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  issueDate: z.union([z.string(), z.date()]).optional(),
  dueDate: z.union([z.string(), z.date()]).nullable().optional(),
  taxRate: z.union([z.number(), z.string()]).optional(),
  notes: z.string().max(5000).nullable().optional(),
  terms: z.string().max(5000).nullable().optional(),
  items: z.array(lineItemSchema).min(1, 'At least one line item is required'),
});

// `status` is deliberately part of the update schema so that a bad value is
// rejected by validation (400/422) instead of being silently stripped - but it
// is never applied: invoice status only changes through the issue / void /
// payment (and refund) endpoints, so hand-edited statuses stay impossible.
const invoiceUpdateSchema = invoiceBodySchema.partial().extend({
  status: z.nativeEnum(InvoiceStatus).optional(),
});

const issueSchema = z.object({
  issueDate: z.union([z.string(), z.date()]).optional(),
  dueDate: z.union([z.string(), z.date()]).nullable().optional(),
  sendEmail: z.boolean().optional(),
});

const voidSchema = z.object({ reason: z.string().trim().min(3, 'A reason is required').max(500) });

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

async function getCompany() {
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

invoicesRouter.get(
  '/',
  requirePermission('invoices.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'createdAt');
    const where: Prisma.InvoiceWhereInput = {
      ...(query.search ? { invoiceNo: { contains: query.search } } : {}),
      ...(req.query.status ? { status: String(req.query.status) as InvoiceStatus } : {}),
      ...(req.query.clientId ? { clientId: String(req.query.clientId) } : {}),
      ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}),
      ...(req.query.overdue === 'true'
        ? { status: { notIn: ['PAID', 'VOID', 'DRAFT'] }, dueDate: { lt: new Date() } }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? { issueDate: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lte: query.dateTo } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true, projectNo: true } },
        },
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.invoice.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

invoicesRouter.post(
  '/',
  requirePermission('invoices.create'),
  validate(invoiceBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof invoiceBodySchema>;
    const client = await prisma.client.findFirst({ where: { id: data.clientId, deletedAt: null } });
    if (!client) throw new AppError('Client not found', 404);

    const totals = computeDocumentTotals(data.items as LineItemInput[], data.taxRate ?? 0);

    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNo = await numbering.invoiceNumber(tx);
      return tx.invoice.create({
        data: {
          invoiceNo,
          clientId: client.id,
          projectId: data.projectId ?? null,
          orderId: data.orderId ?? null,
          status: 'DRAFT',
          currency: data.currency ?? client.currency,
          issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxRate: new Prisma.Decimal(data.taxRate ?? 0),
          taxTotal: totals.taxTotal,
          total: totals.total,
          amountPaid: new Prisma.Decimal(0),
          balance: totals.total,
          notes: data.notes ?? null,
          terms: data.terms ?? null,
          createdById: req.user!.id,
          items: { create: lineCreate(totals.lines) },
        },
        include: { items: true, client: true },
      });
    });

    await writeAudit(req, { action: 'invoice.create', module: 'invoices', entityId: invoice.id });
    return sendCreated(res, invoice, 'Invoice created as draft');
  }),
);

invoicesRouter.get(
  '/:id',
  requirePermission('invoices.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        client: true,
        project: { select: { id: true, name: true, projectNo: true } },
        payments: { where: { isVoid: false }, orderBy: { paidAt: 'desc' } },
        refunds: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!invoice) throw new AppError('Invoice not found', 404);
    return sendSuccess(res, invoice);
  }),
);

invoicesRouter.patch(
  '/:id',
  requirePermission('invoices.update'),
  validate(idParamSchema, 'params'),
  validate(invoiceUpdateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof invoiceUpdateSchema>;
    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!existing) throw new AppError('Invoice not found', 404);
    if (data.status !== undefined) {
      throw new AppError('Invoice status cannot be edited directly - issue, void, record a payment or record a refund instead', 422);
    }
    if (existing.status !== 'DRAFT') throw new AppError('Only draft invoices can be edited', 409);

    const totals = data.items ? computeDocumentTotals(data.items as LineItemInput[], data.taxRate ?? existing.taxRate) : null;

    const invoice = await prisma.$transaction(async (tx) => {
      if (totals) await tx.invoiceItem.deleteMany({ where: { invoiceId: existing.id } });
      return tx.invoice.update({
        where: { id: existing.id },
        data: {
          ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
          ...(data.orderId !== undefined ? { orderId: data.orderId } : {}),
          ...(data.currency !== undefined ? { currency: data.currency } : {}),
          ...(data.issueDate !== undefined ? { issueDate: new Date(data.issueDate) } : {}),
          ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.terms !== undefined ? { terms: data.terms } : {}),
          ...(totals
            ? {
                subtotal: totals.subtotal,
                discountTotal: totals.discountTotal,
                taxRate: new Prisma.Decimal(data.taxRate ?? existing.taxRate),
                taxTotal: totals.taxTotal,
                total: totals.total,
                balance: totals.total,
                items: { create: lineCreate(totals.lines) },
              }
            : {}),
        },
        include: { items: true, client: true },
      });
    });
    return sendSuccess(res, invoice, { message: 'Invoice updated' });
  }),
);

invoicesRouter.delete(
  '/:id',
  requirePermission('invoices.delete'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { payments: true } });
    if (!existing) throw new AppError('Invoice not found', 404);
    if (existing.status !== 'DRAFT') throw new AppError('Only draft invoices can be deleted', 409);
    await prisma.invoice.delete({ where: { id: existing.id } });
    await writeAudit(req, { action: 'invoice.delete', module: 'invoices', entityId: existing.id });
    return sendNoContent(res);
  }),
);

invoicesRouter.post(
  '/:id/issue',
  requirePermission('invoices.issue'),
  validate(idParamSchema, 'params'),
  validate(issueSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof issueSchema>;
    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { client: true } });
    if (!existing) throw new AppError('Invoice not found', 404);
    if (existing.status !== 'DRAFT') throw new AppError('Only draft invoices can be issued', 409);

    const company = await getCompany();
    const issueDate = data.issueDate ? new Date(data.issueDate) : new Date();
    const dueDate = data.dueDate
      ? new Date(data.dueDate)
      : existing.dueDate ?? new Date(issueDate.getTime() + company.paymentTermsDays * 86400000);

    // Issuing records revenue. It never marks the invoice paid - that only
    // happens when confirmed payments settle the balance.
    const invoice = await prisma.invoice.update({
      where: { id: existing.id },
      data: { status: 'ISSUED', issueDate, dueDate, sentAt: new Date() },
      include: { items: true, client: true },
    });

    if (data.sendEmail !== false) {
      const mail = invoiceEmail(
        invoice.invoiceNo,
        clientName(invoice.client),
        formatMoney(invoice.total, invoice.currency),
        dueDate.toISOString().slice(0, 10),
      );
      await sendMail({ to: invoice.client.email, ...mail });
    }

    await logActivity({
      actorId: req.user!.id,
      action: 'invoice.issued',
      entityType: 'Invoice',
      entityId: invoice.id,
      clientId: invoice.clientId,
      projectId: invoice.projectId,
      summary: `Invoice ${invoice.invoiceNo} issued for ${formatMoney(invoice.total, invoice.currency)}`,
      isClientVisible: true,
    });
    await notifyPermissionHolders('invoices.view', {
      type: 'INVOICE_ISSUED',
      title: 'Invoice issued',
      message: `${invoice.invoiceNo} • ${formatMoney(invoice.total, invoice.currency)}`,
      entityType: 'Invoice',
      entityId: invoice.id,
      link: `/invoices/${invoice.id}`,
      dedupeKey: `invoice-issued:${invoice.id}`,
    }, { discordEvent: 'invoice.issued' });
    await writeAudit(req, { action: 'invoice.issue', module: 'invoices', entityId: invoice.id });
    return sendSuccess(res, invoice, { message: 'Invoice issued' });
  }),
);

invoicesRouter.post(
  '/:id/void',
  requirePermission('invoices.void'),
  validate(idParamSchema, 'params'),
  validate(voidSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof voidSchema>;
    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { payments: { where: { isVoid: false } } } });
    if (!existing) throw new AppError('Invoice not found', 404);
    if (existing.status === 'VOID') throw new AppError('Invoice is already void', 409);
    if (existing.payments.length > 0) {
      throw new AppError('Void the associated payments before voiding this invoice', 409);
    }

    const invoice = await prisma.invoice.update({
      where: { id: existing.id },
      data: { status: 'VOID', voidedAt: new Date(), voidReason: data.reason, balance: new Prisma.Decimal(0) },
    });
    await writeAudit(req, { action: 'invoice.void', module: 'invoices', entityId: invoice.id, details: { reason: data.reason } });
    return sendSuccess(res, invoice, { message: 'Invoice voided' });
  }),
);

invoicesRouter.post(
  '/:id/remind',
  requirePermission('invoices.issue'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { client: true } });
    if (!invoice) throw new AppError('Invoice not found', 404);
    if (['PAID', 'VOID', 'DRAFT'].includes(invoice.status)) {
      throw new AppError('Reminders can only be sent for unpaid issued invoices', 409);
    }
    const mail = invoiceEmail(
      invoice.invoiceNo,
      clientName(invoice.client),
      formatMoney(invoice.balance, invoice.currency),
      invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : '-',
    );
    await sendMail({ to: invoice.client.email, ...mail });
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { reminderCount: { increment: 1 }, lastReminderAt: new Date() },
    });
    return sendSuccess(res, updated, { message: 'Reminder sent' });
  }),
);

invoicesRouter.get(
  '/:id/pdf',
  requirePermission('invoices.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { items: { orderBy: { sortOrder: 'asc' } }, client: true },
    });
    if (!invoice) throw new AppError('Invoice not found', 404);
    const company = await getCompany();

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
