import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Prisma } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../config/prisma';
import { Api, resetDatabase, seedCatalogue, signInWithPermissions } from './helpers';

/**
 * Invoice integration tests.
 *
 * The route/service files are authoritative:
 *   src/routes/invoice.routes.ts
 *   src/routes/helpers.ts
 *   src/services/financeService.ts
 *   src/services/numberingService.ts
 *
 * Money is asserted exclusively with Prisma.Decimal (arbitrary precision) - the
 * API serialises every Decimal to a string, never a float.
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

/** Decimal-exact money assertion (never uses JS floating point). */
function expectMoney(actual: unknown, expected: string): void {
  expect(money(actual).toFixed(2)).toBe(money(expected).toFixed(2));
}

let clientSeq = 0;
async function createClient(label = 'Acme'): Promise<string> {
  clientSeq += 1;
  const client = await prisma.client.create({
    data: {
      companyName: `${label} ${clientSeq} Ltd`,
      firstName: label,
      lastName: 'Client',
      email: `${label.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}-${clientSeq}@client.test`,
      currency: 'LKR',
      status: 'ACTIVE',
    },
  });
  return client.id;
}

const FINANCE_PERMISSIONS = [
  'invoices.view',
  'invoices.create',
  'invoices.update',
  'invoices.delete',
  'invoices.issue',
  'invoices.void',
  'payments.view',
  'payments.record',
  'refunds.manage',
  'expenses.view',
  'expenses.create',
  'dashboard.view',
  'reports.view',
  'reports.finance',
];

async function financeApi(): Promise<Api> {
  const { api } = await signInWithPermissions(app, FINANCE_PERMISSIONS);
  return api;
}

async function createInvoice(api: Api, clientId: string, overrides: Record<string, unknown> = {}) {
  return api.post('/invoices', {
    clientId,
    items: [{ description: 'Service', quantity: 1, unitPrice: '100.00' }],
    ...overrides,
  });
}

/* --------------------------------- tests ---------------------------------- */

describe('invoices: creation and computed totals', () => {
  it('computes subtotal, discount, tax, total, balance and amountPaid from line items', async () => {
    const api = await financeApi();
    const clientId = await createClient('Totals');

    const res = await createInvoice(api, clientId, {
      items: [
        { description: 'Design', quantity: 2, unitPrice: '100.00' },
        { description: 'Hosting', quantity: 3, unitPrice: '50.00', discount: '10.00' },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const invoice = res.body.data;
    expect(invoice.status).toBe('DRAFT');
    expectMoney(invoice.subtotal, '340.00');
    expectMoney(invoice.discountTotal, '10.00');
    expectMoney(invoice.taxTotal, '0.00');
    expectMoney(invoice.total, '340.00');
    expectMoney(invoice.balance, '340.00');
    expectMoney(invoice.amountPaid, '0.00');

    const lineTotals = (invoice.items as Array<{ lineTotal: string }>).map((item) =>
      money(item.lineTotal).toFixed(2),
    );
    expect(lineTotals).toEqual(['200.00', '140.00']);
  });

  it('applies an absolute line discount together with a percentage tax rate using 2dp half-up rounding', async () => {
    const api = await financeApi();
    const clientId = await createClient('Rounding');

    // gross  = round(2 x 1234.567) = 2469.13
    // line   = 2469.13 - 49.99     = 2419.14 (subtotal)
    // tax    = round(2419.14 x 7.5%) = round(181.4355) = 181.44
    // total  = 2419.14 + 181.44    = 2600.58
    const res = await createInvoice(api, clientId, {
      taxRate: 7.5,
      items: [{ description: 'Retainer', quantity: 2, unitPrice: '1234.567', discount: '49.99' }],
    });

    expect(res.status).toBe(201);
    const invoice = res.body.data;
    expectMoney(invoice.subtotal, '2419.14');
    expectMoney(invoice.discountTotal, '49.99');
    expectMoney(invoice.taxTotal, '181.44');
    expectMoney(invoice.total, '2600.58');
    expectMoney(invoice.balance, '2600.58');
  });

  it('never drifts on floating-point-hostile cents (7 x 0.01 = 0.07 exactly)', async () => {
    const api = await financeApi();
    const clientId = await createClient('Drift');

    const res = await createInvoice(api, clientId, {
      items: Array.from({ length: 7 }, (_, index) => ({
        description: `Micro item ${index + 1}`,
        quantity: 1,
        unitPrice: '0.01',
      })),
    });

    expect(res.status).toBe(201);
    expectMoney(res.body.data.subtotal, '0.07');
    expectMoney(res.body.data.total, '0.07');
  });
});

describe('invoices: document numbering', () => {
  it('assigns sequential, unique invoice numbers', async () => {
    const api = await financeApi();
    const clientId = await createClient('Numbering');

    const first = await createInvoice(api, clientId);
    const second = await createInvoice(api, clientId);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const firstNo = first.body.data.invoiceNo as string;
    const secondNo = second.body.data.invoiceNo as string;
    expect(firstNo).not.toBe(secondNo);

    const seq = (invoiceNo: string) => Number(invoiceNo.split('-').pop());
    expect(seq(secondNo)).toBe(seq(firstNo) + 1);

    const total = await prisma.invoice.count({ where: { invoiceNo: { in: [firstNo, secondNo] } } });
    expect(total).toBe(2);
  });
});

describe('invoices: permissions', () => {
  it('requires invoices.create to create an invoice (403 without)', async () => {
    const { api } = await signInWithPermissions(app, ['invoices.view']);
    const clientId = await createClient('NoCreate');

    const res = await createInvoice(api, clientId);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('requires invoices.view to list invoices (403 without)', async () => {
    const { api } = await signInWithPermissions(app, ['invoices.create']);

    const res = await api.get('/invoices');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('requires invoices.delete to delete a draft (403 without)', async () => {
    const finance = await financeApi();
    const clientId = await createClient('NoDelete');
    const created = await createInvoice(finance, clientId);
    const id = created.body.data.id as string;

    const { api } = await signInWithPermissions(app, ['invoices.view']);
    const res = await api.del(`/invoices/${id}`);
    expect(res.status).toBe(403);

    // The draft must still exist.
    expect(await prisma.invoice.count({ where: { id } })).toBe(1);
  });

  it('requires invoices.void to void an invoice (403 without)', async () => {
    const finance = await financeApi();
    const clientId = await createClient('NoVoid');
    const created = await createInvoice(finance, clientId);
    const id = created.body.data.id as string;
    await finance.post(`/invoices/${id}/issue`);

    const { api } = await signInWithPermissions(app, ['invoices.view']);
    const res = await api.post(`/invoices/${id}/void`, { reason: 'not allowed' });
    expect(res.status).toBe(403);
  });
});

describe('invoices: status transitions and deletion', () => {
  it('cannot mark a DRAFT invoice PAID through the generic update', async () => {
    const api = await financeApi();
    const clientId = await createClient('Status');
    const created = await createInvoice(api, clientId);
    const id = created.body.data.id as string;

    const patch = await api.patch(`/invoices/${id}`, { status: 'PAID' });
    // The update endpoint accepts the draft edit...
    expect([200, 422]).toContain(patch.status);

    // ...but the invoice must not have become PAID through the generic update.
    const after = await api.get(`/invoices/${id}`);
    expect(after.body.data.status).toBe('DRAFT');
    expectMoney(after.body.data.amountPaid, '0.00');
  });

  it('rejects an invalid invoice status value with 400/422', async () => {
    const api = await financeApi();
    const clientId = await createClient('BadStatus');
    const created = await createInvoice(api, clientId);
    const id = created.body.data.id as string;

    const res = await api.patch(`/invoices/${id}`, { status: 'NOT_A_REAL_STATUS' });
    expect([400, 422]).toContain(res.status);
  });

  it('refuses to edit a non-draft invoice (409)', async () => {
    const api = await financeApi();
    const clientId = await createClient('IssueEdit');
    const created = await createInvoice(api, clientId);
    const id = created.body.data.id as string;

    const issued = await api.post(`/invoices/${id}/issue`);
    expect(issued.status).toBe(200);

    const res = await api.patch(`/invoices/${id}`, {
      items: [{ description: 'Changed', quantity: 1, unitPrice: '5.00' }],
    });
    expect(res.status).toBe(409);
  });

  it('deletes a draft with invoices.delete and returns 204', async () => {
    const api = await financeApi();
    const clientId = await createClient('Delete');
    const created = await createInvoice(api, clientId);
    const id = created.body.data.id as string;

    const res = await api.del(`/invoices/${id}`);
    expect(res.status).toBe(204);
    expect(await prisma.invoice.count({ where: { id } })).toBe(0);
  });

  it('voids an issued invoice and zeroes the balance', async () => {
    const api = await financeApi();
    const clientId = await createClient('Void');
    const created = await createInvoice(api, clientId);
    const id = created.body.data.id as string;
    await api.post(`/invoices/${id}/issue`);

    const res = await api.post(`/invoices/${id}/void`, { reason: 'Client cancelled the engagement' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('VOID');
    expectMoney(res.body.data.balance, '0.00');
  });

  it('returns 404 for an unknown invoice id', async () => {
    const api = await financeApi();
    const res = await api.get('/invoices/does-not-exist-xyz');
    expect(res.status).toBe(404);
  });
});

describe('invoices: zero paid is not revenue', () => {
  it('a freshly created invoice is unpaid and adds no cash received', async () => {
    const api = await financeApi();
    const clientId = await createClient('ZeroPaid');

    const created = await createInvoice(api, clientId, {
      items: [{ description: 'Kickoff', quantity: 1, unitPrice: '999.99' }],
    });
    expect(created.status).toBe(201);
    expectMoney(created.body.data.amountPaid, '0.00');
    expectMoney(created.body.data.balance, '999.99');

    const dashboard = await api.get('/dashboard');
    expect(dashboard.status).toBe(200);
    // Cash received is driven by payments only - a draft invoice contributes none.
    expectMoney(dashboard.body.data.kpis.receivedPayments, '0.00');
  });
});
