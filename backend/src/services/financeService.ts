import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { add, dec, isZero, max, percentOf, round, sub, ZERO } from '../utils/money';

export interface LineItemInput {
  description: string;
  quantity: number | string | Prisma.Decimal;
  unitPrice: number | string | Prisma.Decimal;
  discount?: number | string | Prisma.Decimal;
  sortOrder?: number;
}

export interface TotalsResult {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxableBase: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  lines: Array<LineItemInput & { lineTotal: Prisma.Decimal }>;
}

/**
 * Documented calculation formulas (used by both quotations and invoices):
 *
 *   lineTotal      = (quantity x unitPrice) - discount        (never below 0)
 *   subtotal       = SUM(lineTotal)
 *   discountTotal  = SUM(discount)
 *   taxableBase    = subtotal                                  (lineTotal already net of discount)
 *   taxTotal       = taxableBase x (taxRate / 100)
 *   total          = subtotal + taxTotal
 *
 * "Invoiced revenue" is the sum of issued invoice totals. It is NOT cash
 * received; cash received is the sum of confirmed payments. Profit is never
 * equal to revenue alone (see computeProjectProfit).
 */
export function computeDocumentTotals(
  items: LineItemInput[],
  taxRate: number | string | Prisma.Decimal = 0,
): TotalsResult {
  if (!items.length) {
    throw new AppError('At least one line item is required', 422);
  }

  let subtotal = ZERO;
  let discountTotal = ZERO;

  const lines = items.map((item, index) => {
    const gross = round(dec(item.quantity).times(dec(item.unitPrice)));
    const discount = round(max(0, dec(item.discount)));
    const lineTotal = max(0, sub(gross, discount));
    subtotal = add(subtotal, lineTotal);
    discountTotal = add(discountTotal, discount);
    return { ...item, sortOrder: item.sortOrder ?? index, lineTotal };
  });

  subtotal = round(subtotal);
  discountTotal = round(discountTotal);
  const taxableBase = subtotal;
  const taxTotal = percentOf(taxableBase, dec(taxRate));
  const total = round(add(taxableBase, taxTotal));

  return { subtotal, discountTotal, taxableBase, taxTotal, total, lines };
}

/**
 * Recomputes and persists an invoice's stored totals from its line items and
 * confirmed payments. Runs inside the caller's transaction when provided.
 */
export async function recalculateInvoice(invoiceId: string) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true, payments: true, refunds: true },
    });
    if (!invoice) throw new AppError('Invoice not found', 404);

    const totals = computeDocumentTotals(invoice.items, invoice.taxRate);

    const confirmedPayments = invoice.payments.filter((payment) => !payment.isVoid);
    const paid = confirmedPayments.reduce<Prisma.Decimal>(
      (acc, payment) => add(acc, (payment.currency === invoice.currency ? payment.amount : ZERO)),
       ZERO,
    );
    const refunded = invoice.refunds.reduce<Prisma.Decimal>(
      (acc, refund) => add(acc, (refund.currency === invoice.currency ? refund.amount : ZERO)),
      ZERO,
    );

    const amountPaid = round(add(paid, refunded.negated()));
    const balance = max(0, sub(totals.total, amountPaid));

    let status = invoice.status;
    if (status !== 'VOID' && status !== 'DRAFT') {
      if (isZero(balance) && dec(totals.total).greaterThan(0)) {
        status = 'PAID';
      } else if (dec(amountPaid).greaterThan(0)) {
        status = 'PARTIALLY_PAID';
      } else if (invoice.dueDate && invoice.dueDate.getTime() < Date.now()) {
        status = 'OVERDUE';
      } else {
        status = 'ISSUED';
      }
    }

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        amountPaid,
        balance,
        status,
        paidAt: status === 'PAID' ? invoice.paidAt ?? new Date() : null,
        items: {
          deleteMany: {},
          create: totals.lines.map((line) => ({
            description: line.description,
            quantity: dec(line.quantity),
            unitPrice: dec(line.unitPrice),
            discount: dec(line.discount),
            lineTotal: line.lineTotal,
            sortOrder: line.sortOrder ?? 0,
          })),
        },
      },
      include: { items: true, client: true, project: true },
    });
  });
}

export interface ProjectFinancials {
  currency: string;
  invoicedRevenue: Prisma.Decimal;
  cashReceived: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  expenses: Prisma.Decimal;
  profit: Prisma.Decimal;
  marginPercent: Prisma.Decimal;
}

/**
 * Project profitability.
 *   invoicedRevenue = SUM(issued/paid invoice totals linked to the project)
 *   cashReceived    = SUM(confirmed payments against those invoices)
 *   outstanding     = invoicedRevenue - cashReceived
 *   expenses        = SUM(approved/paid project expenses)
 *   profit          = invoicedRevenue - expenses
 *   marginPercent   = profit / invoicedRevenue x 100
 */
export async function computeProjectFinancials(projectId: string, currency: string): Promise<ProjectFinancials> {
  const [invoices, expenses] = await Promise.all([
    prisma.invoice.findMany({
      where: { projectId, status: { notIn: ['DRAFT', 'VOID'] } },
      select: { total: true, amountPaid: true, currency: true },
    }),
    prisma.expense.findMany({
      where: { projectId, status: { in: ['APPROVED', 'PAID'] } },
      select: { amount: true, taxAmount: true, currency: true },
    }),
  ]);

  const invoicedRevenue = round(
    invoices
      .filter((invoice) => invoice.currency === currency)
      .reduce<Prisma.Decimal>((acc, invoice) => add(acc, invoice.total), ZERO),
  );
  const cashReceived = round(
    invoices
      .filter((invoice) => invoice.currency === currency)
      .reduce<Prisma.Decimal>((acc, invoice) => add(acc, invoice.amountPaid), ZERO),
  );
  const expenseTotal = round(
    expenses
      .filter((expense) => expense.currency === currency)
      .reduce<Prisma.Decimal>((acc, expense) => add(acc, expense.amount, expense.taxAmount), ZERO),
  );

  const profit = round(sub(invoicedRevenue, expenseTotal));
  const marginPercent = invoicedRevenue.greaterThan(0)
    ? round(dec(profit).div(invoicedRevenue).times(100), 2)
    : ZERO;

  return {
    currency,
    invoicedRevenue,
    cashReceived,
    outstanding: round(max(0, sub(invoicedRevenue, cashReceived))),
    expenses: expenseTotal,
    profit,
    marginPercent,
  };
}

/**
 * Financial summary with clearly separated concepts so profit is never
 * confused with revenue or cash.
 */
export async function computeFinanceSummary(currency: string, from?: Date, to?: Date) {
  const dateFilter = from || to ? { gte: from, lte: to } : undefined;

  const [invoices, payments, expenses, refunds] = await Promise.all([
    prisma.invoice.findMany({
      where: { currency, status: { notIn: ['VOID'] }, issueDate: dateFilter },
      select: { total: true, amountPaid: true, balance: true, status: true, dueDate: true },
    }),
    prisma.payment.findMany({
      where: { currency, isVoid: false, paidAt: dateFilter },
      select: { amount: true },
    }),
    prisma.expense.findMany({
      where: { currency, status: { in: ['APPROVED', 'PAID'] }, expenseDate: dateFilter },
      select: { amount: true, taxAmount: true },
    }),
    prisma.refund.findMany({
      where: { currency, createdAt: dateFilter },
      select: { amount: true, kind: true },
    }),
  ]);

  const invoicedRevenue = round(invoices.reduce<Prisma.Decimal>((a, i) => add(a, i.total), ZERO));
  const cashReceived = round(payments.reduce<Prisma.Decimal>((a, p) => add(a, p.amount), ZERO));
  const expenseTotal = round(expenses.reduce<Prisma.Decimal>((a, e) => add(a, e.amount, e.taxAmount), ZERO));
  const refundTotal = round(refunds.reduce<Prisma.Decimal>((a, r) => add(a, r.amount), ZERO));

  const outstandingReceivables = round(
    invoices
      .filter((invoice) => invoice.status !== 'PAID')
      .reduce<Prisma.Decimal>((a, invoice) => add(a, max(0, invoice.balance)), ZERO),
  );
  const overdueAmount = round(
    invoices
      .filter((invoice) => invoice.status !== 'PAID' && invoice.dueDate && invoice.dueDate.getTime() < Date.now())
      .reduce<Prisma.Decimal>((a, invoice) => add(a, max(0, invoice.balance)), ZERO),
  );

  const grossProfit = round(sub(invoicedRevenue, expenseTotal));
  const netOperatingResult = round(sub(sub(cashReceived, refundTotal), expenseTotal));
  const marginPercent = invoicedRevenue.greaterThan(0)
    ? round(dec(grossProfit).div(invoicedRevenue).times(100), 2)
    : ZERO;

  return {
    currency,
    invoicedRevenue,
    cashReceived,
    refunds: refundTotal,
    expenses: expenseTotal,
    grossProfit,
    netOperatingResult,
    outstandingReceivables,
    overdueAmount,
    availableCash: round(sub(cashReceived, sub(expenseTotal, refundTotal.negated()))),
    marginPercent,
    invoiceCount: invoices.length,
  };
}
