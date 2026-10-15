import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Prisma } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../config/prisma';
import { Api, TestUser, resetDatabase, seedCatalogue, createUser, signInWithPermissions } from './helpers';

/**
 * Reports integration tests: revenue, expenses, cash flow, receivables aging,
 * client history, project profitability, member earnings, service performance,
 * date-range filtering, CSV export and permission gating.
 *
 * Authoritative sources:
 *   src/routes/report.routes.ts
 *   src/services/reportService.ts
 *   src/services/financeService.ts  (computeProjectFinancials / computeFinanceSummary)
 *   src/services/dashboardService.ts
 *   src/utils/csv.ts                (sendCsv: BOM + text/csv)
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
  const category = await prisma.expenseCategory.upsert({ where: { name }, update: {}, create: { name } });
  return category.id;
}

const REPORT_PERMISSIONS = [
  'invoices.view',
  'invoices.create',
  'invoices.issue',
  'payments.view',
  'payments.record',
  'refunds.manage',
  'expenses.view',
  'expenses.create',
  'expenses.approve',
  'projects.view',
  'projects.viewAll',
  'projects.create',
  'projects.update',
  'projects.assign',
  'allocations.view',
  'allocations.manage',
  'allocations.approve',
  'earnings.viewAll',
  'payouts.view',
  'payouts.manage',
  'dashboard.view',
  'reports.view',
  'reports.finance',
  'reports.team',
];

/** Creates an invoice and immediately issues it (issuing records revenue, not cash). */
async function createIssuedInvoice(
  api: Api,
  clientId: string,
  total: string,
  currency: string,
  projectId?: string,
) {
  const created = await api.post('/invoices', {
    clientId,
    ...(projectId ? { projectId } : {}),
    currency,
    items: [{ description: 'Delivery', quantity: 1, unitPrice: total }],
  });
  if (created.status !== 201) {
    throw new Error(`Invoice fixture failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const id = created.body.data.id as string;
  const issued = await api.post(`/invoices/${id}/issue`, { sendEmail: false });
  if (issued.status !== 200) {
    throw new Error(`Issue failed: ${issued.status} ${JSON.stringify(issued.body)}`);
  }
  return issued.body.data as Record<string, unknown>;
}

/**
 * Shared deterministic fixture, isolated by a currency (CAD) that no other test
 * file uses:
 *
 *   Client Northwind -> 1000.00 issued invoice (linked to project P) + 400.00 payment - 100.00 refund
 *   Client Northwind ->  500.00 issued invoice (no payment)
 *   Client Contoso   ->  300.00 issued invoice + 100.00 payment
 *
 *   Expenses: Software 120.00 + 30.00 tax (linked to project P), Travel 50.00
 *
 *   invoiced revenue 1800.00 / cash received 500.00 / refunds 100.00 / expenses 200.00
 */
const CURRENCY = 'CAD';

let reportApi: Api;
let clientXId: string;
let clientYId: string;
let memberUser: TestUser;
let projectId: string;
let invoice1Id: string;
let payment1Id: string;

beforeAll(async () => {
  const { api } = await signInWithPermissions(app, REPORT_PERMISSIONS);
  reportApi = api;

  clientXId = await createClient('Northwind', CURRENCY);
  clientYId = await createClient('Contoso', CURRENCY);
  // Needs a staff role: team-workload only lists users holding a non-CLIENT role.
  memberUser = await createUser({ firstName: 'Mia', lastName: 'Member', permissions: ['invoices.view'] });

  const project = await reportApi.post('/projects', {
    name: 'Cad Platform',
    clientId: clientXId,
    currency: CURRENCY,
    status: 'IN_PROGRESS',
  });
  if (project.status !== 201) {
    throw new Error(`Project fixture failed: ${project.status} ${JSON.stringify(project.body)}`);
  }
  projectId = project.body.data.id as string;
  await reportApi.post(`/projects/${projectId}/members`, { userId: memberUser.id, role: 'Member' });

  const invoice1 = await createIssuedInvoice(reportApi, clientXId, '1000.00', CURRENCY, projectId);
  invoice1Id = invoice1.id as string;
  await createIssuedInvoice(reportApi, clientXId, '500.00', CURRENCY);
  const invoice3 = await createIssuedInvoice(reportApi, clientYId, '300.00', CURRENCY);

  const payment1 = await reportApi.post('/payments', { invoiceId: invoice1Id, amount: '400.00', method: 'BANK_TRANSFER' });
  if (payment1.status !== 201) {
    throw new Error(`Payment fixture failed: ${payment1.status} ${JSON.stringify(payment1.body)}`);
  }
  payment1Id = payment1.body.data.id as string;
  await reportApi.post('/payments', { invoiceId: invoice3.id as string, amount: '100.00' });

  const refund = await reportApi.post('/refunds', {
    invoiceId: invoice1Id,
    paymentId: payment1Id,
    amount: '100.00',
    reason: 'Goodwill credit',
  });
  if (refund.status !== 201) {
    throw new Error(`Refund fixture failed: ${refund.status} ${JSON.stringify(refund.body)}`);
  }

  const software = await createCategory('Software');
  const travel = await createCategory('Travel');
  const expense1 = await reportApi.post('/expenses', {
    categoryId: software,
    projectId,
    description: 'Design suite licence',
    amount: '120.00',
    taxAmount: '30.00',
    currency: CURRENCY,
    status: 'APPROVED',
  });
  if (expense1.status !== 201) {
    throw new Error(`Expense fixture failed: ${expense1.status} ${JSON.stringify(expense1.body)}`);
  }
  await reportApi.post('/expenses', {
    categoryId: travel,
    description: 'Site visit',
    amount: '50.00',
    taxAmount: '0.00',
    currency: CURRENCY,
    status: 'APPROVED',
  });
});

/* --------------------------------- tests ---------------------------------- */

describe('reports: revenue and expenses reflect the ledger exactly', () => {
  it('revenue report totals invoiced, received and outstanding per month and per invoice', async () => {
    const res = await reportApi.get(`/reports/revenue?currency=${CURRENCY}`);
    expect(res.status).toBe(200);
    expect(res.body.data.currency).toBe(CURRENCY);

    const rows = res.body.data.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);

    const byMonth = res.body.data.byMonth as Array<{ month: string; invoiced: number; received: number; outstanding: number }>;
    expect(byMonth).toHaveLength(1);
    expectMoney(byMonth[0].invoiced, '1800.00');
    expectMoney(byMonth[0].received, '400.00');
    expectMoney(byMonth[0].outstanding, '1400.00');
  });

  it('an issued invoice with a partial payment and a refund has the exact net position', async () => {
    const res = await reportApi.get(`/invoices/${invoice1Id}`);
    expect(res.status).toBe(200);
    expectMoney(res.body.data.total, '1000.00');
    // 400 paid - 100 refunded = 300 net cash.
    expectMoney(res.body.data.amountPaid, '300.00');
    expectMoney(res.body.data.balance, '700.00');
    expect(res.body.data.status).toBe('PARTIALLY_PAID');
  });

  it('expense report groups by category with tax included in the total', async () => {
    const res = await reportApi.get(`/reports/expenses?currency=${CURRENCY}`);
    expect(res.status).toBe(200);

    const rows = res.body.data.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);

    const byCategory = res.body.data.byCategory as Array<{ category: string; total: number }>;
    expect(byCategory).toHaveLength(2);
    const totals = new Map(byCategory.map((row) => [row.category, row.total]));
    expectMoney(totals.get('Software'), '150.00');
    expectMoney(totals.get('Travel'), '50.00');
    // Sorted descending by total.
    expect(byCategory[0].category).toBe('Software');
  });
});

describe('reports: cash flow and dashboard reconcile', () => {
  it('cash-flow reports payment inflow, expense outflow and refunds for the period', async () => {
    const res = await reportApi.get(`/reports/cash-flow?currency=${CURRENCY}`);
    expect(res.status).toBe(200);

    const rows = res.body.data.rows as Array<{ month: string; inflow: number; outflow: number; net: number }>;
    const totals = rows.reduce(
      (acc, row) => ({
        inflow: acc.inflow.plus(money(row.inflow)),
        outflow: acc.outflow.plus(money(row.outflow)),
      }),
      { inflow: money(0), outflow: money(0) },
    );
    expect(totals.inflow.toFixed(2)).toBe('500.00'); // 400 + 100 payments
    expect(totals.outflow.toFixed(2)).toBe('300.00'); // 150 + 50 expenses + 100 refund
  });

  it('cash-flow net reconciles with the dashboard net operating result', async () => {
    const cashFlow = (await reportApi.get(`/reports/cash-flow?currency=${CURRENCY}`)).body.data.rows as Array<{
      inflow: number;
      outflow: number;
    }>;
    const cashNet = cashFlow.reduce((acc, row) => acc.plus(money(row.inflow)).minus(money(row.outflow)), money(0));

    const kpis = (await reportApi.get(`/dashboard?currency=${CURRENCY}`)).body.data.kpis;
    // Dashboard: (cash 500 - refunds 100) - expenses 200 = 200.
    expectMoney(kpis.netOperatingResult, '200.00');

    // The cash-flow report must agree with the dashboard about net operating
    // cash: refunds are an outflow in both views.
    expect(
      cashNet.toFixed(2),
      `cash-flow net ${cashNet.toFixed(2)} must equal dashboard net operating result ${money(kpis.netOperatingResult).toFixed(2)}`,
    ).toBe(money(kpis.netOperatingResult).toFixed(2));
  });
});

describe('reports: receivables aging and client history', () => {
  it('invoice aging buckets outstanding balances for non-paid invoices', async () => {
    const res = await reportApi.get(`/reports/invoice-aging?currency=${CURRENCY}`);
    expect(res.status).toBe(200);

    const rows = res.body.data.rows as Array<Record<string, unknown>>;
    // Issued/partially paid invoices only (2 partially paid + 1 issued).
    expect(rows).toHaveLength(3);

    const buckets = res.body.data.buckets as Record<string, string>;
    const totalBucketed = Object.values(buckets).reduce((acc, value) => acc.plus(money(value)), money(0));
    expect(totalBucketed.toFixed(2)).toBe('1400.00'); // 700 + 500 + 200

    // All three invoices are within their payment terms, so everything is "current".
    expectMoney(buckets.current, '1400.00');
  });

  it('client history reports lifetime value, paid and outstanding per client', async () => {
    const res = await reportApi.get(`/reports/client-history?currency=${CURRENCY}`);
    expect(res.status).toBe(200);

    const rows = res.body.data.rows as Array<Record<string, unknown>>;
    const byName = new Map(rows.map((row) => [row.name as string, row]));

    const northwind = byName.get('Northwind 1 Ltd');
    expect(northwind).toBeDefined();
    expect(northwind!.invoices).toBe(2);
    expectMoney(northwind!.lifetimeValue, '1500.00'); // 1000 + 500
    expectMoney(northwind!.paid, '300.00'); // net of the 100 refund
    expectMoney(northwind!.outstanding, '1200.00');

    const contoso = byName.get('Contoso 2 Ltd');
    expect(contoso).toBeDefined();
    expect(contoso!.invoices).toBe(1);
    expectMoney(contoso!.lifetimeValue, '300.00');
    expectMoney(contoso!.paid, '100.00');
    expectMoney(contoso!.outstanding, '200.00');
  });
});

describe('reports: project profitability, member earnings and service performance', () => {
  it('project profitability separates invoiced revenue, cash received and expenses', async () => {
    const res = await reportApi.get(`/reports/project-profitability?currency=${CURRENCY}`);
    expect(res.status).toBe(200);

    const rows = res.body.data.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expectMoney(row.invoicedRevenue, '1000.00');
    expectMoney(row.cashReceived, '300.00'); // 400 paid - 100 refunded
    expectMoney(row.expenses, '150.00'); // project-linked Software expense
    expectMoney(row.profit, '850.00'); // 1000 - 150
    expectMoney(row.marginPercent, '85.00');
  });

  it('member earnings accrue exactly from a committed allocation rule', async () => {
    const rule = await reportApi.post('/allocations/rules', {
      projectId,
      name: 'Solo split',
      model: 'PERCENT_OF_REVENUE',
      items: [{ userId: memberUser.id, percent: 100 }],
    });
    expect(rule.status).toBe(201);
    const commit = await reportApi.post(`/allocations/projects/${projectId}/commit`, { ruleId: rule.body.data.id });
    expect(commit.status).toBe(201);

    const res = await reportApi.get(`/reports/member-earnings?currency=${CURRENCY}`);
    expect(res.status).toBe(200);

    const earnings = res.body.data.earnings as Array<Record<string, unknown>>;
    expect(earnings).toHaveLength(1);
    expect(earnings[0].member).toBe('Mia Member');
    expectMoney(earnings[0].amount, '1000.00'); // 100% of 1000 invoiced revenue

    // No payout has been recorded yet: everything is accrued, nothing is paid.
    expectMoney(res.body.data.totals.accrued, '1000.00');
    expectMoney(res.body.data.totals.paid, '0.00');
    expectMoney(res.body.data.totals.pending, '0.00');
  });

  it('service performance groups by service and derives profit', async () => {
    const res = await reportApi.get(`/reports/service-performance?currency=${CURRENCY}`);
    expect(res.status).toBe(200);

    const rows = res.body.data.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.service).toBe('Unassigned service');
    expect(row.projects).toBe(1);
    expectMoney(row.revenue, '1000.00');
    expectMoney(row.expenses, '150.00');
    expectMoney(row.profit, '850.00');
  });

  it('team workload includes staff members and reports logged hours', async () => {
    const res = await reportApi.get('/reports/team-workload');
    expect(res.status).toBe(200);
    const rows = res.body.data.rows as Array<Record<string, unknown>>;
    const member = rows.find((row) => row.id === memberUser.id);
    expect(member).toBeDefined();
    expect(member!.name).toBe('Mia Member');
    expectMoney(member!.loggedHours, '0.00');
  });

  it('lead conversion funnel starts empty, and support performance has all priorities', async () => {
    const leads = await reportApi.get('/reports/lead-conversion');
    expect(leads.status).toBe(200);
    expect(leads.body.data.total).toBe(0);
    expect(leads.body.data.conversionRate).toBe(0);

    const support = await reportApi.get('/reports/support');
    expect(support.status).toBe(200);
    expect(support.body.data.total).toBe(0);
    expect((support.body.data.byPriority as unknown[])).toHaveLength(4);
  });
});

describe('reports: date-range filtering', () => {
  it('excludes records outside the requested date range', async () => {
    const future = (await reportApi.get(`/reports/revenue?currency=${CURRENCY}&dateFrom=2999-01-01&dateTo=2999-12-31`)).body.data;
    expect(future.rows).toHaveLength(0);

    const past = (await reportApi.get(`/reports/revenue?currency=${CURRENCY}&dateFrom=2000-01-01&dateTo=2000-12-31`)).body.data;
    expect(past.rows).toHaveLength(0);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const current = (
      await reportApi.get(`/reports/revenue?currency=${CURRENCY}&dateFrom=${yesterday}&dateTo=${tomorrow}`)
    ).body.data;
    expect(current.rows).toHaveLength(3);
  });
});

describe('reports: CSV exports', () => {
  const csvEndpoints = [
    '/reports/revenue/export',
    '/reports/expenses/export',
    '/reports/invoice-aging/export',
    '/reports/client-history/export',
    '/reports/project-profitability/export',
  ];

  for (const endpoint of csvEndpoints) {
    it(`${endpoint} streams a UTF-8 BOM CSV attachment`, async () => {
      const res = await reportApi.get(`${endpoint}?currency=${CURRENCY}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(String(res.headers['content-disposition'])).toMatch(/attachment; filename=/);

      const body = res.text;
      expect(body.length).toBeGreaterThan(0);
      // Byte-order mark so Excel reads UTF-8 correctly.
      expect(body.charCodeAt(0)).toBe(0xfeff);
    });
  }

  it('revenue export includes one data row per invoice', async () => {
    const res = await reportApi.get(`/reports/revenue/export?currency=${CURRENCY}`);
    const lines = res.text.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toContain('Invoice');
    expect(lines[0]).toContain('Outstanding');
    expect(lines).toHaveLength(4); // header + 3 invoices
  });
});

describe('reports: permission gating', () => {
  it('rejects a user with no report permissions', async () => {
    const { api } = await signInWithPermissions(app, ['dashboard.view']);
    expect((await api.get(`/reports/revenue?currency=${CURRENCY}`)).status).toBe(403);
    expect((await api.get(`/reports/invoice-aging?currency=${CURRENCY}`)).status).toBe(403);
    expect((await api.get('/reports/team-workload')).status).toBe(403);
    expect((await api.get('/reports/support')).status).toBe(403);
  });

  it('allows reports.view endpoints but blocks finance/team-only endpoints', async () => {
    const { api } = await signInWithPermissions(app, ['reports.view']);
    expect((await api.get(`/reports/service-performance?currency=${CURRENCY}`)).status).toBe(200);
    expect((await api.get(`/reports/client-history?currency=${CURRENCY}`)).status).toBe(200);
    expect((await api.get('/reports/lead-conversion')).status).toBe(200);

    expect((await api.get(`/reports/revenue?currency=${CURRENCY}`)).status).toBe(403);
    expect((await api.get(`/reports/expenses?currency=${CURRENCY}`)).status).toBe(403);
    expect((await api.get(`/reports/cash-flow?currency=${CURRENCY}`)).status).toBe(403);
    expect((await api.get(`/reports/member-earnings?currency=${CURRENCY}`)).status).toBe(403);
    expect((await api.get('/reports/team-workload')).status).toBe(403);
  });

  it('lets a reports.finance user read financial reports but not team workload', async () => {
    const { api } = await signInWithPermissions(app, ['reports.finance']);
    expect((await api.get(`/reports/revenue?currency=${CURRENCY}`)).status).toBe(200);
    expect((await api.get(`/reports/cash-flow?currency=${CURRENCY}`)).status).toBe(200);
    expect((await api.get(`/reports/invoice-aging?currency=${CURRENCY}`)).status).toBe(200);
    expect((await api.get('/reports/team-workload')).status).toBe(403);
  });
});
