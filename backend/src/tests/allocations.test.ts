import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Prisma } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../config/prisma';
import { Api, TestUser, resetDatabase, seedCatalogue, createRole, createUser, signIn, signInWithPermissions } from './helpers';

/**
 * Profit-allocation integration tests (rules, preview, earnings and payouts).
 *
 * Authoritative sources:
 *   src/routes/allocation.routes.ts
 *   src/routes/earning.routes.ts
 *   src/routes/payout.routes.ts
 *   src/services/allocationService.ts
 *   src/services/financeService.ts  (computeProjectFinancials)
 *   prisma/schema.prisma            (AllocationRule / MemberEarning / MemberPayout)
 */

let app: Express;
let memberA: TestUser;
let memberB: TestUser;
let memberC: TestUser;

beforeAll(async () => {
  app = createApp();
  await resetDatabase();
  await seedCatalogue();
  memberA = await createUser({ firstName: 'Ana', lastName: 'Analyst' });
  memberB = await createUser({ firstName: 'Bo', lastName: 'Builder' });
  memberC = await createUser({ firstName: 'Cy', lastName: 'Creative' });
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

const ALLOC_PERMISSIONS = [
  'invoices.view',
  'invoices.create',
  'invoices.issue',
  'projects.view',
  'projects.viewAll',
  'projects.create',
  'projects.update',
  'projects.assign',
  'allocations.view',
  'allocations.manage',
  'allocations.approve',
  'earnings.viewOwn',
  'earnings.viewAll',
  'payouts.view',
  'payouts.manage',
  'payouts.approve',
  'expenses.view',
  'expenses.create',
  'expenses.approve',
  'dashboard.view',
];

async function adminApi(): Promise<Api> {
  const { api } = await signInWithPermissions(app, ALLOC_PERMISSIONS);
  return api;
}

const memberIds = () => [memberA.id, memberB.id, memberC.id];

async function createProjectWithMembers(api: Api, clientId: string, currency: string): Promise<string> {
  const project = await api.post('/projects', {
    name: 'Allocated build',
    clientId,
    currency,
    status: 'IN_PROGRESS',
  });
  if (project.status !== 201) {
    throw new Error(`Project fixture failed: ${project.status} ${JSON.stringify(project.body)}`);
  }
  const projectId = project.body.data.id as string;
  for (const userId of memberIds()) {
    const member = await api.post(`/projects/${projectId}/members`, { userId, role: 'Member' });
    if (member.status !== 201 && member.status !== 200) {
      throw new Error(`Adding member failed: ${member.status} ${JSON.stringify(member.body)}`);
    }
  }
  return projectId;
}

/** Issues an invoice linked to the project so invoicedRevenue (and profit) are exact. */
async function issueProjectInvoice(
  api: Api,
  clientId: string,
  projectId: string,
  total: string,
  currency: string,
): Promise<string> {
  const created = await api.post('/invoices', {
    clientId,
    projectId,
    currency,
    items: [{ description: 'Delivery', quantity: 1, unitPrice: total }],
  });
  if (created.status !== 201) {
    throw new Error(`Invoice fixture failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const issued = await api.post(`/invoices/${created.body.data.id}/issue`, { sendEmail: false });
  if (issued.status !== 200) {
    throw new Error(`Issue failed: ${issued.status} ${JSON.stringify(issued.body)}`);
  }
  return created.body.data.id as string;
}

async function createRule(
  api: Api,
  projectId: string,
  name: string,
  model: string,
  items: Array<{ userId: string; percent?: number; fixedAmount?: number }>,
) {
  return api.post('/allocations/rules', { projectId, name, model, items });
}

/* --------------------------------- tests ---------------------------------- */

describe('allocation rules: arbitrary custom percentages', () => {
  it('accepts a 37.5 / 22.5 / 40 split for three members with nothing hardcoded', async () => {
    const api = await adminApi();
    const clientId = await createClient('Split', 'USD');
    const projectId = await createProjectWithMembers(api, clientId, 'USD');

    const rule = await createRule(api, projectId, 'Custom split', 'PERCENT_OF_REVENUE', [
      { userId: memberA.id, percent: 37.5 },
      { userId: memberB.id, percent: 22.5 },
      { userId: memberC.id, percent: 40 },
    ]);

    expect(rule.status).toBe(201);
    expect(rule.body.data.version).toBe(1);
    expect(rule.body.data.isActive).toBe(true);

    const byUser = new Map(
      (rule.body.data.items as Array<{ userId: string; percent: string }>).map((item) => [item.userId, item.percent]),
    );
    expectMoney(byUser.get(memberA.id), '37.50');
    expectMoney(byUser.get(memberB.id), '22.50');
    expectMoney(byUser.get(memberC.id), '40.00');

    // Percentages are persisted verbatim in the catalogue of rules.
    const listed = await api.get(`/allocations/rules?projectId=${projectId}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
  });

  it('rejects a rule whose percentages do not sum to 100', async () => {
    const api = await adminApi();
    const clientId = await createClient('BadSplit', 'USD');
    const projectId = await createProjectWithMembers(api, clientId, 'USD');

    const rule = await createRule(api, projectId, 'Over-allocation', 'PERCENT_OF_REVENUE', [
      { userId: memberA.id, percent: 50 },
      { userId: memberB.id, percent: 40 },
      { userId: memberC.id, percent: 30 },
    ]);

    // Percentages that sum to 120% must be rejected outright, not silently normalised.
    expect(
      rule.status,
      `a rule summing to 120% must be rejected, got ${rule.status}: ${JSON.stringify(rule.body)}`,
    ).toBeGreaterThanOrEqual(400);
  });
});

describe('allocation rules: versioning is immutable', () => {
  it('creating a new version never mutates an older version or its earnings', async () => {
    const api = await adminApi();
    const clientId = await createClient('Version', 'USD');
    const projectId = await createProjectWithMembers(api, clientId, 'USD');
    await issueProjectInvoice(api, clientId, projectId, '1000.00', 'USD');

    const v1 = await createRule(api, projectId, 'Split v1', 'PERCENT_OF_REVENUE', [
      { userId: memberA.id, percent: 37.5 },
      { userId: memberB.id, percent: 22.5 },
      { userId: memberC.id, percent: 40 },
    ]);
    expect(v1.status).toBe(201);
    const v1RuleId = v1.body.data.id as string;

    const commit = await api.post(`/allocations/projects/${projectId}/commit`, { ruleId: v1RuleId });
    expect(commit.status).toBe(201);
    const v1Earnings = await prisma.memberEarning.findMany({
      where: { projectId, ruleId: v1RuleId },
      orderBy: { createdAt: 'asc' },
    });
    expect(v1Earnings).toHaveLength(3);

    // Now supersede with a different split.
    const v2 = await createRule(api, projectId, 'Split v2', 'PERCENT_OF_REVENUE', [
      { userId: memberA.id, percent: 60 },
      { userId: memberB.id, percent: 20 },
      { userId: memberC.id, percent: 20 },
    ]);
    expect(v2.status).toBe(201);
    const v2RuleId = v2.body.data.id as string;
    expect(v2.body.data.version).toBe(2);
    expect(v2.body.data.isActive).toBe(true);

    // v1 is superseded but its stored percentages are untouched.
    const listed = await api.get(`/allocations/rules?projectId=${projectId}`);
    const rules = listed.body.data as Array<{ id: string; version: number; isActive: boolean; items: Array<{ percent: string }> }>;
    const v1Row = rules.find((row) => row.id === v1RuleId)!;
    const v2Row = rules.find((row) => row.id === v2RuleId)!;
    expect(v1Row.isActive).toBe(false);
    expect(v2Row.isActive).toBe(true);
    expect(v1Row.items.map((item) => money(item.percent).toFixed(2))).toEqual(['37.50', '22.50', '40.00']);
    expect(v2Row.items.map((item) => money(item.percent).toFixed(2))).toEqual(['60.00', '20.00', '20.00']);

    // Previously created earnings are unchanged by the new version.
    const v1After = await prisma.memberEarning.findMany({
      where: { projectId, ruleId: v1RuleId },
      orderBy: { createdAt: 'asc' },
    });
    expect(v1After.map((earning) => earning.ruleVersion)).toEqual([1, 1, 1]);
    expect(v1After.map((earning) => money(earning.amount).toFixed(2))).toEqual(
      v1Earnings.map((earning) => money(earning.amount).toFixed(2)),
    );
  });
});

describe('allocation preview: computed but never written', () => {
  it('returns entitlements without creating any MemberEarning rows', async () => {
    const api = await adminApi();
    const clientId = await createClient('Preview', 'USD');
    const projectId = await createProjectWithMembers(api, clientId, 'USD');
    await issueProjectInvoice(api, clientId, projectId, '1000.00', 'USD');

    const rule = await createRule(api, projectId, 'Preview split', 'PERCENT_OF_REVENUE', [
      { userId: memberA.id, percent: 37.5 },
      { userId: memberB.id, percent: 22.5 },
      { userId: memberC.id, percent: 40 },
    ]);
    const ruleId = rule.body.data.id as string;

    const beforeCount = await prisma.memberEarning.count({ where: { projectId } });
    expect(beforeCount).toBe(0);

    const preview = await api.get(`/allocations/projects/${projectId}/preview?ruleId=${ruleId}`);
    expect(preview.status).toBe(200);
    expectMoney(preview.body.data.distributableAmount, '1000.00');
    expectMoney(preview.body.data.allocatedTotal, '1000.00');
    expect(preview.body.data.reconciled).toBe(true);

    const lines = preview.body.data.lines as Array<{ userId: string; amount: string }>;
    const amounts = new Map(lines.map((line) => [line.userId, line.amount]));
    expectMoney(amounts.get(memberA.id), '375.00');
    expectMoney(amounts.get(memberB.id), '225.00');
    expectMoney(amounts.get(memberC.id), '400.00');

    // Preview must not persist anything.
    const afterCount = await prisma.memberEarning.count({ where: { projectId } });
    expect(afterCount).toBe(0);
  });

  it('derives distributable profit as invoiced revenue minus expenses for PERCENT_OF_PROFIT', async () => {
    const api = await adminApi();
    const clientId = await createClient('Profit', 'USD');
    const projectId = await createProjectWithMembers(api, clientId, 'USD');
    await issueProjectInvoice(api, clientId, projectId, '2000.00', 'USD');

    const category = await prisma.expenseCategory.upsert({ where: { name: 'Subcontractors' }, update: {}, create: { name: 'Subcontractors' } });
    const expense = await api.post('/expenses', {
      categoryId: category.id,
      projectId,
      description: 'Contractor fee',
      amount: '500.00',
      currency: 'USD',
      status: 'APPROVED',
    });
    expect(expense.status).toBe(201);

    const rule = await createRule(api, projectId, 'Profit split', 'PERCENT_OF_PROFIT', [
      { userId: memberA.id, percent: 100 },
    ]);
    const ruleId = rule.body.data.id as string;

    const preview = await api.get(`/allocations/projects/${projectId}/preview?ruleId=${ruleId}`);
    expect(preview.status).toBe(200);
    expectMoney(preview.body.data.invoicedRevenue, '2000.00');
    expectMoney(preview.body.data.expenses, '500.00');
    expectMoney(preview.body.data.distributableAmount, '1500.00');
  });
});

describe('allocation commit: earnings reconcile exactly', () => {
  it('reconciles a 1000.00 three-way split with no rounding leftovers', async () => {
    const api = await adminApi();
    const clientId = await createClient('Reconcile', 'USD');
    const projectId = await createProjectWithMembers(api, clientId, 'USD');
    await issueProjectInvoice(api, clientId, projectId, '1000.00', 'USD');

    const rule = await createRule(api, projectId, 'Even split', 'PERCENT_OF_REVENUE', [
      { userId: memberA.id, percent: 37.5 },
      { userId: memberB.id, percent: 22.5 },
      { userId: memberC.id, percent: 40 },
    ]);
    const ruleId = rule.body.data.id as string;

    const commit = await api.post(`/allocations/projects/${projectId}/commit`, { ruleId });
    expect(commit.status).toBe(201);

    const earnings = await prisma.memberEarning.findMany({ where: { projectId, ruleId } });
    const byUser = new Map(earnings.map((earning) => [earning.userId, earning]));
    expectMoney(byUser.get(memberA.id)!.amount, '375.00');
    expectMoney(byUser.get(memberB.id)!.amount, '225.00');
    expectMoney(byUser.get(memberC.id)!.amount, '400.00');

    const sum = earnings.reduce((acc, earning) => acc.plus(earning.amount), money(0));
    expect(sum.toFixed(2)).toBe('1000.00');
    expect(commit.body.data.preview.reconciled).toBe(true);
  });

  it('reconciles an awkward 9999.99 three-way split exactly (largest-remainder)', async () => {
    const api = await adminApi();
    const clientId = await createClient('ReconcileOdd', 'USD');
    const projectId = await createProjectWithMembers(api, clientId, 'USD');
    await issueProjectInvoice(api, clientId, projectId, '9999.99', 'USD');

    const rule = await createRule(api, projectId, 'Awkward split', 'PERCENT_OF_REVENUE', [
      { userId: memberA.id, percent: 37.5 },
      { userId: memberB.id, percent: 22.5 },
      { userId: memberC.id, percent: 40 },
    ]);
    const ruleId = rule.body.data.id as string;

    const commit = await api.post(`/allocations/projects/${projectId}/commit`, { ruleId });
    expect(commit.status).toBe(201);

    const earnings = await prisma.memberEarning.findMany({ where: { projectId, ruleId } });
    const byUser = new Map(earnings.map((earning) => [earning.userId, earning]));
    expectMoney(byUser.get(memberA.id)!.amount, '3750.00');
    expectMoney(byUser.get(memberB.id)!.amount, '2250.00');
    expectMoney(byUser.get(memberC.id)!.amount, '3999.99');

    const sum = earnings.reduce((acc, earning) => acc.plus(earning.amount), money(0));
    expect(sum.toFixed(2)).toBe('9999.99');
  });
});

describe('earnings vs payouts', () => {
  it('an earning is only an entitlement until a payout is actually recorded', async () => {
    const api = await adminApi();
    const clientId = await createClient('Entitlement', 'USD');
    const projectId = await createProjectWithMembers(api, clientId, 'USD');
    await issueProjectInvoice(api, clientId, projectId, '1000.00', 'USD');

    const rule = await createRule(api, projectId, 'Entitlement split', 'PERCENT_OF_REVENUE', [
      { userId: memberA.id, percent: 100 },
    ]);
    const ruleId = rule.body.data.id as string;
    await api.post(`/allocations/projects/${projectId}/commit`, { ruleId });

    const earnings = await prisma.memberEarning.findMany({ where: { projectId, ruleId } });
    expect(earnings).toHaveLength(1);
    expect(earnings[0].status).toBe('PENDING');

    // An entitlement exists, but no payout has been recorded yet.
    const payoutsBefore = await prisma.memberPayout.count({ where: { userId: memberA.id } });
    expect(payoutsBefore).toBe(0);

    const approve = await api.post(`/earnings/${earnings[0].id}/approve`);
    expect(approve.status).toBe(200);

    const payout = await api.post('/payouts', {
      userId: memberA.id,
      earningIds: [earnings[0].id],
      submitForApproval: true,
    });
    expect(payout.status).toBe(201);
    expectMoney(payout.body.data.amount, '1000.00');

    const payoutsAfter = await prisma.memberPayout.count({ where: { userId: memberA.id } });
    expect(payoutsAfter).toBe(1);

    // Approving then paying the payout flips the earning to PAID.
    expect((await api.post(`/payouts/${payout.body.data.id}/approve`)).status).toBe(200);
    expect((await api.post(`/payouts/${payout.body.data.id}/pay`)).status).toBe(200);
    const paidEarning = await prisma.memberEarning.findUnique({ where: { id: earnings[0].id } });
    expect(paidEarning!.status).toBe('PAID');
  });

  it('recording a payout does not change revenue figures', async () => {
    const api = await adminApi();
    const currency = 'NZD';
    const clientId = await createClient('PayoutRev', currency);
    const projectId = await createProjectWithMembers(api, clientId, currency);
    await issueProjectInvoice(api, clientId, projectId, '3000.00', currency);

    const rule = await createRule(api, projectId, 'Revenue split', 'PERCENT_OF_REVENUE', [
      { userId: memberA.id, percent: 100 },
    ]);
    const ruleId = rule.body.data.id as string;
    await api.post(`/allocations/projects/${projectId}/commit`, { ruleId });
    const earnings = await prisma.memberEarning.findMany({ where: { projectId, ruleId } });
    await api.post(`/earnings/${earnings[0].id}/approve`);

    const snapshot = async () => {
      const dash = (await api.get(`/dashboard?currency=${currency}`)).body.data.kpis;
      return { revenue: dash.totalRevenue as string, cash: dash.receivedPayments as string };
    };
    const before = await snapshot();

    const payout = await api.post('/payouts', { userId: memberA.id, earningIds: [earnings[0].id], submitForApproval: true });
    expect(payout.status).toBe(201);
    await api.post(`/payouts/${payout.body.data.id}/approve`);
    await api.post(`/payouts/${payout.body.data.id}/pay`);

    const after = await snapshot();
    // A payout is an internal distribution, not customer revenue or cash.
    expect(after).toEqual(before);
    expectMoney(after.revenue, '3000.00');
  });
});

describe('allocation and payout endpoints are permission gated', () => {
  it('rejects users without the required allocation / payout permissions (403)', async () => {
    const api = await adminApi();
    const clientId = await createClient('Gate', 'USD');
    const projectId = await createProjectWithMembers(api, clientId, 'USD');
    const rule = await createRule(api, projectId, 'Gate split', 'PERCENT_OF_REVENUE', [
      { userId: memberA.id, percent: 100 },
    ]);
    const ruleId = rule.body.data.id as string;

    // A user with no permissions at all is refused everywhere.
    const { api: none } = await signInWithPermissions(app, []);

    expect((await none.get(`/allocations/rules?projectId=${projectId}`)).status).toBe(403);
    expect((await none.get(`/allocations/projects/${projectId}/preview`)).status).toBe(403);
    expect(
      (await none.post('/allocations/rules', { projectId, name: 'Nope', model: 'PERCENT_OF_REVENUE', items: [{ userId: memberA.id, percent: 100 }] }))
        .status,
    ).toBe(403);
    expect((await none.post(`/allocations/projects/${projectId}/commit`, { ruleId })).status).toBe(403);
    expect((await none.post('/payouts', { userId: memberA.id, earningIds: [ruleId] })).status).toBe(403);
  });

  it('refuses a member approving the payout addressed to them (separation of duties)', async () => {
    const api = await adminApi();
    const clientId = await createClient('Self', 'USD');
    const projectId = await createProjectWithMembers(api, clientId, 'USD');
    await issueProjectInvoice(api, clientId, projectId, '1000.00', 'USD');

    const rule = await createRule(api, projectId, 'Self split', 'PERCENT_OF_REVENUE', [
      { userId: memberA.id, percent: 100 },
    ]);
    const ruleId = rule.body.data.id as string;
    await api.post(`/allocations/projects/${projectId}/commit`, { ruleId });
    const earnings = await prisma.memberEarning.findMany({ where: { projectId, ruleId } });

    // The payout is addressed to memberA, and memberA themselves holds the
    // permission needed to sign it off: entitlement must not become an
    // approved payout with nobody else in the loop.
    const roleId = await createRole(`self-approve-role-${memberA.id}`, ['payouts.view', 'payouts.approve']);
    await prisma.userRole.create({ data: { userId: memberA.id, roleId } });

    const payout = await api.post('/payouts', {
      userId: memberA.id,
      earningIds: [earnings[0].id],
      submitForApproval: true,
    });
    expect(payout.status).toBe(201);
    const payoutId = payout.body.data.id as string;

    const memberApi = await signIn(app, memberA);
    const res = await memberApi.post(`/payouts/${payoutId}/approve`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/cannot be approved by the member it is paid to/i);
    const stored = await prisma.memberPayout.findUnique({ where: { id: payoutId } });
    expect(stored!.status).not.toBe('APPROVED');
    expect(stored!.approvedById).toBeNull();

    // A different approver (the admin) still can sign it off.
    expect((await api.post(`/payouts/${payoutId}/approve`)).status).toBe(200);
    const after = await prisma.memberPayout.findUnique({ where: { id: payoutId } });
    expect(after!.status).toBe('APPROVED');
  });
});
