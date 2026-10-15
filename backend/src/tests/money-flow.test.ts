import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Prisma } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../config/prisma';
import { Api, resetDatabase, seedCatalogue, createUser, signIn, signInWithPermissions } from './helpers';

/**
 * Money-flow integration tests: payments, refunds, expenses and the separation
 * of invoiced revenue / cash received / expenses.
 *
 * Authoritative sources:
 *   src/routes/payment.routes.ts
 *   src/routes/refund.routes.ts
 *   src/routes/expense.routes.ts
 *   src/routes/dashboard.routes.ts + src/services/dashboardService.ts
 *   src/routes/report.routes.ts + src/services/reportService.ts
 *   src/services/financeService.ts
 */

let app: Express;

beforeAll(async () => {
  app = createApp();
  await resetDatabase();
  await seedCatalogue();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/* ------------------------------- helpers ---------------------------------- */

const money = (value: unknown) => new Prisma.Decimal(String(value));

function expectMoney(actual: unknown, expected: string): void {
  expect(money(actual).toFixed(2)).toBe(money(expected).toFixed(2));
}

let clientSeq = 0;
async function createClient(label = 'Acme', currency = 'LKR'): Promise<string> {
  clientSeq += 1;
  const client = await prisma.client.create({
    data: {
      companyName: `${label} ${clientSeq} Ltd`,
      firstName: label,
      lastName: 'Client',
      email: `${label.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}-${clientSeq}@client.test`,
      currency,
      status: 'ACTIVE',
    },
  });
  return client.id;
}

async function createCategory(name: string): Promise<string> {
  const category = await prisma.expenseCategory.upsert({
    where: { name },
    update: {},
    create: { name },
  });
  return category.id;
}

const MONEY_PERMISSIONS = [
  'invoices.view',
  'invoices.create',
  'invoices.update',
  'invoices.delete',
  'invoices.issue',
  'invoices.void',
  'payments.view',
  'payments.record',
  'payments.void',
  'refunds.manage',
  'expenses.view',
  'expenses.create',
  'expenses.update',
  'expenses.approve',
  'quotations.view',
  'quotations.create',
  'quotations.update',
  'projects.view',
  'projects.viewAll',
  'projects.create',
  'projects.update',
  'tickets.view',
  'tickets.viewAll',
  'tickets.create',
  'tickets.update',
  'dashboard.view',
  'reports.view',
  'reports.finance',
];

async function moneyApi(): Promise<Api> {
  const { api } = await signInWithPermissions(app, MONEY_PERMISSIONS);
  return api;
}

/** Creates an invoice and immediately issues it (issuing records revenue, not cash). */
async function createIssuedInvoice(
  api: Api,
  clientId: string,
  items: Array<Record<string, unknown>>,
  currency = 'LKR',
  taxRate: number | string = 0,
) {
  const created = await api.post('/invoices', { clientId, currency, taxRate, items });
  if (created.status !== 201) {
    throw new Error(`Invoice fixture failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const id = created.body.data.id as string;
  const issued = await api.post(`/invoices/${id}/issue`, { sendEmail: false });
  if (issued.status !== 200) {
    throw new Error(`Invoice issue failed: ${issued.status} ${JSON.stringify(issued.body)}`);
  }
  return issued.body.data as Record<string, unknown>;
}

/* --------------------------------- tests ---------------------------------- */

describe('payments: partial and full settlement', () => {
  it('increases amountPaid and decreases balance with exact decimal arithmetic', async () => {
    const api = await moneyApi();
    const clientId = await createClient('Partial', 'EUR');
    const invoice = await createIssuedInvoice(
      api,
      clientId,
      [{ description: 'Sprint 1', quantity: 1, unitPrice: '1000.00' }],
      'EUR',
    );
    const id = invoice.id as string;
    expectMoney(invoice.total, '1000.00');
    expect(invoice.status).toBe('ISSUED');

    const partial = await api.post('/payments', { invoiceId: id, amount: '400.00', method: 'BANK_TRANSFER' });
    expect(partial.status).toBe(201);
    expectMoney(partial.body.data.amount, '400.00');

    const afterPartial = await api.get(`/invoices/${id}`);
    expectMoney(afterPartial.body.data.amountPaid, '400.00');
    expectMoney(afterPartial.body.data.balance, '600.00');
    expect(afterPartial.body.data.status).toBe('PARTIALLY_PAID');

    const full = await api.post('/payments', { invoiceId: id, amount: '600.00' });
    expect(full.status).toBe(201);

    const afterFull = await api.get(`/invoices/${id}`);
    expectMoney(afterFull.body.data.amountPaid, '1000.00');
    expectMoney(afterFull.body.data.balance, '0.00');
    expect(afterFull.body.data.status).toBe('PAID');
  });

  it('rejects an overpayment beyond the outstanding balance', async () => {
    const api = await moneyApi();
    const clientId = await createClient('Overpay', 'EUR');
    const invoice = await createIssuedInvoice(
      api,
      clientId,
      [{ description: 'Logo', quantity: 1, unitPrice: '100.00' }],
      'EUR',
    );
    const id = invoice.id as string;

    const res = await api.post('/payments', { invoiceId: id, amount: '150.00' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(String(res.body.message)).toMatch(/exceeds the outstanding balance/i);

    const after = await api.get(`/invoices/${id}`);
    expectMoney(after.body.data.amountPaid, '0.00');
    expect(after.body.data.status).toBe('ISSUED');
  });
});

describe('refunds: cannot exceed the amount paid', () => {
  it('rejects a refund larger than the cash already received', async () => {
    const api = await moneyApi();
    const clientId = await createClient('Refund', 'EUR');
    const invoice = await createIssuedInvoice(
      api,
      clientId,
      [{ description: 'Campaign', quantity: 1, unitPrice: '500.00' }],
      'EUR',
    );
    const id = invoice.id as string;

    const payment = await api.post('/payments', { invoiceId: id, amount: '100.00' });
    expect(payment.status).toBe(201);

    const refund = await api.post('/refunds', {
      invoiceId: id,
      paymentId: payment.body.data.id,
      amount: '200.00',
      reason: 'Too much',
    });

    // A refund can never exceed cash received for the invoice.
    expect(
      refund.status,
      `over-refund must be rejected, got ${refund.status}: ${JSON.stringify(refund.body)}`,
    ).toBeGreaterThanOrEqual(400);

    // Regardless of the response, the invoice must never end up with negative cash.
    const after = await api.get(`/invoices/${id}`);
    expect(money(after.body.data.amountPaid).greaterThanOrEqualTo(0)).toBe(true);
  });

  it('accepts a refund within the amount paid and reduces cash received', async () => {
    const api = await moneyApi();
    const clientId = await createClient('RefundOk', 'EUR');
    const invoice = await createIssuedInvoice(
      api,
      clientId,
      [{ description: 'Retainer', quantity: 1, unitPrice: '500.00' }],
      'EUR',
    );
    const id = invoice.id as string;
    await api.post('/payments', { invoiceId: id, amount: '300.00' });

    const refund = await api.post('/refunds', { invoiceId: id, amount: '100.00', reason: 'Goodwill' });
    expect(refund.status).toBe(201);
    expectMoney(refund.body.data.amount, '100.00');

    const after = await api.get(`/invoices/${id}`);
    expectMoney(after.body.data.amountPaid, '200.00');
    expectMoney(after.body.data.balance, '300.00');
  });
});

describe('expenses: no effect on invoices or payments', () => {
  it('recording an expense leaves invoice and payment amounts untouched', async () => {
    const api = await moneyApi();
    const clientId = await createClient('Expense', 'EUR');
    const invoice = await createIssuedInvoice(
      api,
      clientId,
      [{ description: 'Website', quantity: 1, unitPrice: '1000.00' }],
      'EUR',
    );
    const id = invoice.id as string;
    await api.post('/payments', { invoiceId: id, amount: '250.00' });

    const beforeInvoice = (await api.get(`/invoices/${id}`)).body.data;
    const beforePayments = await prisma.payment.aggregate({ where: { invoiceId: id }, _sum: { amount: true } });

    const categoryId = await createCategory('Software');
    const expense = await api.post('/expenses', {
      categoryId,
      description: 'Design suite licence',
      amount: '120.00',
      taxAmount: '30.00',
      currency: 'EUR',
      status: 'APPROVED',
    });
    expect(expense.status).toBe(201);
    expectMoney(expense.body.data.amount, '120.00');

    const afterInvoice = (await api.get(`/invoices/${id}`)).body.data;
    const afterPayments = await prisma.payment.aggregate({ where: { invoiceId: id }, _sum: { amount: true } });

    expectMoney(afterInvoice.amountPaid, String(beforeInvoice.amountPaid));
    expectMoney(afterInvoice.balance, String(beforeInvoice.balance));
    expect(afterInvoice.status).toBe(beforeInvoice.status);
    expect(String(afterPayments._sum.amount)).toBe(String(beforePayments._sum.amount));
  });
});

describe('revenue vs cash vs expenses separation', () => {
  it('reports invoiced revenue, cash received and expenses as distinct exact figures', async () => {
    const api = await moneyApi();
    const currency = 'SEK';
    const clientId = await createClient('Separation', currency);

    const invoice = await createIssuedInvoice(
      api,
      clientId,
      [{ description: 'Platform build', quantity: 1, unitPrice: '1000.00' }],
      currency,
    );
    await api.post('/payments', { invoiceId: invoice.id as string, amount: '400.00' });

    const categoryId = await createCategory('Hosting');
    const expense = await api.post('/expenses', {
      categoryId,
      description: 'Cloud hosting',
      amount: '120.00',
      taxAmount: '30.00',
      currency,
      status: 'APPROVED',
    });
    expect(expense.status).toBe(201);

    const dashboard = await api.get(`/dashboard?currency=${currency}`);
    expect(dashboard.status).toBe(200);
    const kpis = dashboard.body.data.kpis;
    expectMoney(kpis.totalRevenue, '1000.00'); // invoiced, not cash
    expectMoney(kpis.receivedPayments, '400.00'); // cash received
    expectMoney(kpis.totalExpenses, '150.00'); // 120 + 30 tax
    expectMoney(kpis.netProfit, '850.00'); // invoiced - expenses
    expectMoney(kpis.netOperatingResult, '250.00'); // cash - expenses
    expectMoney(kpis.outstandingInvoices, '600.00');
    expect(money(kpis.totalRevenue).equals(money(kpis.receivedPayments))).toBe(false);

    const revenue = await api.get(`/reports/revenue?currency=${currency}`);
    expect(revenue.status).toBe(200);
    const revenueRows = revenue.body.data.rows as Array<Record<string, unknown>>;
    expect(revenueRows).toHaveLength(1);
    expectMoney(revenueRows[0].total, '1000.00');
    expectMoney(revenueRows[0].received, '400.00');
    expectMoney(revenueRows[0].outstanding, '600.00');

    const expenses = await api.get(`/reports/expenses?currency=${currency}`);
    expect(expenses.status).toBe(200);
    const expenseRows = expenses.body.data.rows as Array<Record<string, unknown>>;
    expect(expenseRows).toHaveLength(1);
    expectMoney(expenseRows[0].amount, '120.00');
    expectMoney(expenseRows[0].tax, '30.00');
    const byCategory = expenses.body.data.byCategory as Array<{ total: number }>;
    expect(money(byCategory[0].total).toFixed(2)).toBe('150.00');

    const cashFlow = await api.get(`/reports/cash-flow?currency=${currency}`);
    expect(cashFlow.status).toBe(200);
    const cashRows = cashFlow.body.data.rows as Array<Record<string, number>>;
    const totals = cashRows.reduce(
      (acc, row) => ({ inflow: acc.inflow.plus(money(row.inflow)), outflow: acc.outflow.plus(money(row.outflow)) }),
      { inflow: money(0), outflow: money(0) },
    );
    expect(totals.inflow.toFixed(2)).toBe('400.00');
    expect(totals.outflow.toFixed(2)).toBe('150.00');
    expect(totals.inflow.minus(totals.outflow).toFixed(2)).toBe('250.00');
  });
});

describe('draft documents and lifecycle events never create revenue', () => {
  it('creating a QUOTATION does not change any revenue figure', async () => {
    const api = await moneyApi();
    const currency = 'GBP';
    const clientId = await createClient('Quotation', currency);

    const beforeDash = (await api.get(`/dashboard?currency=${currency}`)).body.data.kpis;
    const beforeRevenue = (await api.get(`/reports/revenue?currency=${currency}`)).body.data;

    const quotation = await api.post('/quotations', {
      clientId,
      title: 'Proposed engagement',
      currency,
      items: [{ description: 'Discovery', quantity: 1, unitPrice: '5000.00' }],
    });
    expect(quotation.status).toBe(201);
    expect(quotation.body.data.status).toBe('DRAFT');
    expectMoney(quotation.body.data.total, '5000.00');

    const afterDash = (await api.get(`/dashboard?currency=${currency}`)).body.data.kpis;
    const afterRevenue = (await api.get(`/reports/revenue?currency=${currency}`)).body.data;

    expectMoney(beforeDash.totalRevenue, String(afterDash.totalRevenue));
    expectMoney(beforeDash.receivedPayments, String(afterDash.receivedPayments));
    expectMoney(beforeDash.totalExpenses, String(afterDash.totalExpenses));
    expectMoney(afterDash.totalRevenue, '0.00');
    expect((afterRevenue.rows as unknown[]).length).toBe((beforeRevenue.rows as unknown[]).length);
  });

  it('marking a PROJECT complete does not mark its invoices paid', async () => {
    const api = await moneyApi();
    const currency = 'AUD';
    const clientId = await createClient('Project', currency);

    const projectRes = await api.post('/projects', {
      name: 'Delivered build',
      clientId,
      currency,
      status: 'IN_PROGRESS',
    });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.data.id as string;

    const created = await api.post('/invoices', {
      clientId,
      projectId,
      currency,
      items: [{ description: 'Milestone 1', quantity: 1, unitPrice: '800.00' }],
    });
    const invoiceId = created.body.data.id as string;
    await api.post(`/invoices/${invoiceId}/issue`, { sendEmail: false });

    const before = (await api.get(`/invoices/${invoiceId}`)).body.data;
    expect(before.status).toBe('ISSUED');
    expectMoney(before.amountPaid, '0.00');

    const complete = await api.patch(`/projects/${projectId}`, { status: 'COMPLETED' });
    expect(complete.status).toBe(200);
    expect(complete.body.data.status).toBe('COMPLETED');

    const after = (await api.get(`/invoices/${invoiceId}`)).body.data;
    expect(after.status).toBe('ISSUED');
    expectMoney(after.amountPaid, '0.00');
    expectMoney(after.balance, '800.00');
  });

  it('triggering notifications has no financial side effects', async () => {
    const api = await moneyApi();
    const currency = 'CAD';
    const clientId = await createClient('Notify', currency);

    const invoice = await createIssuedInvoice(
      api,
      clientId,
      [{ description: 'Support plan', quantity: 1, unitPrice: '600.00' }],
      currency,
    );
    await api.post('/payments', { invoiceId: invoice.id as string, amount: '200.00' });

    const snapshot = async () => {
      const dash = (await api.get(`/dashboard?currency=${currency}`)).body.data.kpis;
      const revenue = (await api.get(`/reports/revenue?currency=${currency}`)).body.data.rows as Array<
        Record<string, unknown>
      >;
      return {
        revenue: dash.totalRevenue as string,
        cash: dash.receivedPayments as string,
        expenses: dash.totalExpenses as string,
        profit: dash.netProfit as string,
        rows: revenue.map((row) => `${row.total}|${row.received}|${row.outstanding}`),
      };
    };

    const before = await snapshot();

    // A ticket reply notifies the ticket creator (a notification side channel).
    const ticket = await api.post('/tickets', {
      clientId,
      subject: 'Question about my invoice',
      description: 'Please confirm the payment terms.',
    });
    expect(ticket.status).toBe(201);

    const replier = await createUser({ permissions: ['tickets.view', 'tickets.viewAll', 'tickets.update'] });
    const replierApi = await signIn(app, replier);
    const reply = await replierApi.post(`/tickets/${ticket.body.data.id}/messages`, {
      body: 'Payment is due within 14 days.',
    });
    expect(reply.status).toBe(201);

    const notifications = await api.get('/notifications');
    expect(notifications.status).toBe(200);

    const after = await snapshot();
    expect(after).toEqual(before);
  });
});
