import { InvoiceStatus, ProjectStatus, TaskStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { DEFAULT_CURRENCY } from '../config/env';
import { add, dec, ZERO } from '../utils/money';
import { computeFinanceSummary } from './financeService';

const OPEN_PROJECT_STATUSES: ProjectStatus[] = [
  'INQUIRY', 'QUOTATION', 'AWAITING_PAYMENT', 'PLANNING', 'IN_PROGRESS',
  'ON_HOLD', 'REVIEW', 'CLIENT_APPROVAL', 'REVISION_REQUESTED',
];

const OPEN_TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED'];

/**
 * Dashboard aggregation. Every figure is computed from persisted records for the
 * company currency - nothing is hardcoded.
 */
export async function getDashboard(currency = DEFAULT_CURRENCY, from?: Date, to?: Date) {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const dateFilter = from || to ? { gte: from, lte: to } : undefined;

  const [
    finance,
    activeProjects,
    completedProjects,
    awaitingApproval,
    projectStatusGroups,
    pendingQuotations,
    openTickets,
    overdueInvoices,
    upcomingDeadlines,
    recentPayments,
    recentActivities,
    invoiceRows,
    expenseRows,
    paymentRows,
    openTasks,
    clientCount,
  ] = await Promise.all([
    computeFinanceSummary(currency, from, to),
    prisma.project.count({ where: { status: { in: OPEN_PROJECT_STATUSES }, deletedAt: null } }),
    prisma.project.count({ where: { status: 'COMPLETED', deletedAt: null } }),
    prisma.project.count({ where: { status: { in: ['CLIENT_APPROVAL', 'REVIEW'] }, deletedAt: null } }),
    prisma.project.groupBy({ by: ['status'], _count: { _all: true }, where: { deletedAt: null } }),
    prisma.quotation.count({ where: { status: { in: ['DRAFT', 'SENT'] } } }),
    prisma.ticket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT'] } } }),
    prisma.invoice.findMany({
      where: { currency, status: { notIn: ['PAID', 'VOID', 'DRAFT'] }, dueDate: { lt: now } },
      select: { balance: true, invoiceNo: true, dueDate: true, client: { select: { firstName: true, lastName: true, companyName: true } } },
      take: 10,
      orderBy: { dueDate: 'asc' },
    }),
    prisma.project.findMany({
      where: { deadline: { gte: now, lte: in30Days }, status: { in: OPEN_PROJECT_STATUSES }, deletedAt: null },
      select: { id: true, name: true, deadline: true, status: true, priority: true, client: { select: { companyName: true, firstName: true, lastName: true } } },
      orderBy: { deadline: 'asc' },
      take: 8,
    }),
    prisma.payment.findMany({
      where: { currency, isVoid: false },
      orderBy: { paidAt: 'desc' },
      take: 8,
      include: { client: { select: { firstName: true, lastName: true, companyName: true } }, invoice: { select: { invoiceNo: true } } },
    }),
    prisma.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 12,
      include: { actor: { select: { firstName: true, lastName: true } } },
    }),
    prisma.invoice.findMany({
      where: { currency, status: { notIn: ['VOID'] }, ...(dateFilter ? { issueDate: dateFilter } : {}) },
      select: { total: true, issueDate: true, status: true },
    }),
    prisma.expense.findMany({
      where: { currency, status: { in: ['APPROVED', 'PAID'] }, ...(dateFilter ? { expenseDate: dateFilter } : {}) },
      select: { amount: true, taxAmount: true, expenseDate: true, category: { select: { name: true } } },
    }),
    prisma.payment.findMany({
      where: { currency, isVoid: false, ...(dateFilter ? { paidAt: dateFilter } : {}) },
      select: { amount: true, paidAt: true },
    }),
    prisma.task.findMany({
      where: { status: { in: OPEN_TASK_STATUSES }, deletedAt: null },
      select: { id: true, title: true, dueDate: true, status: true, priority: true, assignee: { select: { firstName: true, lastName: true } }, project: { select: { name: true } } },
      orderBy: [{ dueDate: 'asc' }],
      take: 8,
    }),
    prisma.client.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
  ]);

  const monthly = new Map<string, { month: string; revenue: number; expenses: number; cash: number }>();
  const ensureMonth = (date: Date) => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthly.has(key)) monthly.set(key, { month: key, revenue: 0, expenses: 0, cash: 0 });
    return monthly.get(key)!;
  };

  for (const invoice of invoiceRows) ensureMonth(invoice.issueDate).revenue += dec(invoice.total).toNumber();
  for (const expense of expenseRows) {
    const row = ensureMonth(expense.expenseDate);
    row.expenses += dec(add(expense.amount, expense.taxAmount)).toNumber();
  }
  for (const payment of paymentRows) ensureMonth(payment.paidAt).cash += dec(payment.amount).toNumber();

  const monthlySeries = Array.from(monthly.values()).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);

  const expenseByCategory = new Map<string, number>();
  for (const expense of expenseRows) {
    const key = expense.category?.name ?? 'Uncategorised';
    expenseByCategory.set(key, (expenseByCategory.get(key) ?? 0) + dec(add(expense.amount, expense.taxAmount)).toNumber());
  }

  const incomeByService = await prisma.invoiceItem.groupBy({
    by: ['description'],
    _sum: { lineTotal: true },
    where: { invoice: { currency, status: { notIn: ['VOID'] } } },
    orderBy: { _sum: { lineTotal: 'desc' } },
    take: 6,
  });

  const teamWorkload = await prisma.user.findMany({
    where: { status: 'ACTIVE', deletedAt: null, userRoles: { some: { role: { type: { not: 'CLIENT' } } } } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      _count: { select: { tasksAssigned: true } },
    },
    take: 12,
  });

  const activeWorkload = await prisma.task.groupBy({
    by: ['assigneeId'],
    _count: { _all: true },
    where: { status: { in: OPEN_TASK_STATUSES }, assigneeId: { not: null } },
  });
  const workloadMap = new Map(activeWorkload.map((row) => [row.assigneeId, row._count._all]));

  const totalInvoiced = invoiceRows.reduce((acc, invoice) => add(acc, invoice.total), ZERO);

  return {
    generatedAt: now.toISOString(),
    currency,
    kpis: {
      totalRevenue: finance.invoicedRevenue,
      totalExpenses: finance.expenses,
      netProfit: finance.grossProfit,
      netOperatingResult: finance.netOperatingResult,
      outstandingInvoices: finance.outstandingReceivables,
      receivedPayments: finance.cashReceived,
      overdueAmount: finance.overdueAmount,
      activeProjects,
      completedProjects,
      awaitingApprovalProjects: awaitingApproval,
      pendingQuotations,
      openTickets,
      activeClients: clientCount,
      totalInvoicedAllTime: totalInvoiced.toNumber(),
    },
    deadlines: {
      overdueInvoices: overdueInvoices.map((invoice) => ({
        invoiceNo: invoice.invoiceNo,
        dueDate: invoice.dueDate,
        balance: invoice.balance,
        client: invoice.client.companyName || `${invoice.client.firstName} ${invoice.client.lastName}`,
      })),
      upcomingProjects: upcomingDeadlines.map((project) => ({
        id: project.id,
        name: project.name,
        deadline: project.deadline,
        status: project.status,
        priority: project.priority,
        client: project.client.companyName || `${project.client.firstName} ${project.client.lastName}`,
      })),
      myTasks: openTasks.map((task) => ({
        id: task.id,
        title: task.title,
        dueDate: task.dueDate,
        status: task.status,
        priority: task.priority,
        project: task.project?.name ?? null,
        assignee: task.assignee ? `${task.assignee.firstName} ${task.assignee.lastName}` : null,
      })),
    },
    charts: {
      monthly: monthlySeries,
      projectStatus: projectStatusGroups.map((group) => ({ status: group.status, count: group._count._all })),
      expenseByCategory: Array.from(expenseByCategory.entries()).map(([name, total]) => ({ name, total })),
      incomeByService: incomeByService.map((row) => ({ name: row.description, total: dec(row._sum.lineTotal).toNumber() })),
      invoiceStatus: await prisma.invoice.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: { currency },
      }).then((rows) => rows.map((row) => ({ status: row.status as InvoiceStatus, count: row._count._all }))),
    },
    recent: {
      payments: recentPayments.map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.paidAt,
        method: payment.method,
        client: payment.client.companyName || `${payment.client.firstName} ${payment.client.lastName}`,
        invoiceNo: payment.invoice?.invoiceNo ?? null,
      })),
      activities: recentActivities.map((activity) => ({
        id: activity.id,
        summary: activity.summary,
        action: activity.action,
        entityType: activity.entityType,
        createdAt: activity.createdAt,
        actor: activity.actor ? `${activity.actor.firstName} ${activity.actor.lastName}` : 'System',
      })),
      teamWorkload: teamWorkload.map((member) => ({
        id: member.id,
        name: `${member.firstName} ${member.lastName}`,
        openTasks: workloadMap.get(member.id) ?? 0,
        totalTasks: member._count.tasksAssigned,
      })),
    },
  };
}

/** Dashboard for a client portal account - scoped to that client only. */
export async function getClientDashboard(clientId: string) {
  const now = new Date();
  const [projects, invoices, quotations, tickets, updates] = await Promise.all([
    prisma.project.findMany({
      where: { clientId, deletedAt: null },
      select: { id: true, name: true, status: true, progress: true, deadline: true, currency: true },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    }),
    prisma.invoice.findMany({
      where: { clientId, status: { notIn: ['DRAFT', 'VOID'] } },
      select: { id: true, invoiceNo: true, total: true, balance: true, status: true, dueDate: true, currency: true },
      orderBy: { issueDate: 'desc' },
      take: 6,
    }),
    prisma.quotation.findMany({
      where: { clientId, status: { in: ['SENT', 'DRAFT'] } },
      select: { id: true, quotationNo: true, title: true, total: true, currency: true, validUntil: true, status: true },
      take: 6,
    }),
    prisma.ticket.findMany({
      where: { clientId, status: { notIn: ['CLOSED'] } },
      select: { id: true, ticketNo: true, subject: true, status: true, priority: true, updatedAt: true },
      take: 6,
    }),
    prisma.projectUpdate.findMany({
      where: { project: { clientId }, isClientVisible: true },
      select: { id: true, title: true, body: true, createdAt: true, project: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
  ]);

  const outstanding = invoices.reduce((acc, invoice) => add(acc, invoice.balance), ZERO);

  return {
    projects,
    invoices,
    quotations,
    tickets,
    updates,
    outstandingBalance: outstanding,
    overdueInvoiceCount: invoices.filter(
      (invoice) => invoice.status !== 'PAID' && invoice.dueDate && invoice.dueDate.getTime() < now.getTime(),
    ).length,
  };
}
