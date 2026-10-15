import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { add, dec, ZERO } from '../utils/money';
import { computeProjectFinancials } from './financeService';

export interface DateRange {
  from?: Date;
  to?: Date;
}

function invoiceDateFilter(range: DateRange): Prisma.InvoiceWhereInput {
  if (!range.from && !range.to) return {};
  return { issueDate: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } };
}

export const reportService = {
  /** Invoice aging buckets for accounts receivable. */
  async invoiceAging(currency: string) {
    const invoices = await prisma.invoice.findMany({
      where: { currency, status: { notIn: ['PAID', 'VOID', 'DRAFT'] } },
      select: {
        id: true, invoiceNo: true, dueDate: true, balance: true, total: true, status: true,
        client: { select: { companyName: true, firstName: true, lastName: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    const buckets = { current: ZERO, d1_30: ZERO, d31_60: ZERO, d61_90: ZERO, d90plus: ZERO };
    const now = Date.now();

    for (const invoice of invoices) {
      const due = invoice.dueDate ? invoice.dueDate.getTime() : now;
      const daysOverdue = Math.floor((now - due) / (24 * 60 * 60 * 1000));
      if (daysOverdue <= 0) buckets.current = add(buckets.current, invoice.balance);
      else if (daysOverdue <= 30) buckets.d1_30 = add(buckets.d1_30, invoice.balance);
      else if (daysOverdue <= 60) buckets.d31_60 = add(buckets.d31_60, invoice.balance);
      else if (daysOverdue <= 90) buckets.d61_90 = add(buckets.d61_90, invoice.balance);
      else buckets.d90plus = add(buckets.d90plus, invoice.balance);
    }

    const rows = invoices.map((invoice) => ({
      invoiceNo: invoice.invoiceNo,
      client: invoice.client.companyName || `${invoice.client.firstName} ${invoice.client.lastName}`,
      dueDate: invoice.dueDate,
      total: invoice.total,
      balance: invoice.balance,
      status: invoice.status,
      daysOverdue: invoice.dueDate ? Math.max(0, Math.floor((now - invoice.dueDate.getTime()) / 86400000)) : 0,
    }));

    return { buckets, rows };
  },

  /** Per-project profitability across the portfolio. */
  async projectProfitability(currency: string, range: DateRange = {}, limit = 200) {
    const projects = await prisma.project.findMany({
      where: {
        currency,
        deletedAt: null,
        ...(range.from || range.to
          ? { createdAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
          : {}),
      },
      select: {
        id: true, projectNo: true, name: true, status: true,
        client: { select: { companyName: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const rows = await Promise.all(
      projects.map(async (project) => {
        const financials = await computeProjectFinancials(project.id, currency);
        return {
          projectNo: project.projectNo,
          name: project.name,
          client: project.client.companyName || `${project.client.firstName} ${project.client.lastName}`,
          status: project.status,
          invoicedRevenue: financials.invoicedRevenue,
          cashReceived: financials.cashReceived,
          expenses: financials.expenses,
          profit: financials.profit,
          marginPercent: financials.marginPercent,
        };
      }),
    );

    return rows;
  },

  /** Revenue grouped by service category. */
  async servicePerformance(currency: string, range: DateRange = {}) {
    const projects = await prisma.project.findMany({
      where: { currency, deletedAt: null, ...(range.from || range.to ? { createdAt: { gte: range.from, lte: range.to } } : {}) },
      select: { id: true, status: true, service: { select: { name: true, category: true } } },
    });

    const byService = new Map<string, { category: string; projects: number; revenue: number; expenses: number }>();

    for (const project of projects) {
      const key = project.service?.name ?? 'Unassigned service';
      const category = project.service?.category ?? 'General';
      const entry = byService.get(key) ?? { category, projects: 0, revenue: 0, expenses: 0 };
      const financials = await computeProjectFinancials(project.id, currency);
      entry.projects += 1;
      entry.revenue += financials.invoicedRevenue.toNumber();
      entry.expenses += financials.expenses.toNumber();
      byService.set(key, entry);
    }

    return Array.from(byService.entries()).map(([service, data]) => ({
      service,
      category: data.category,
      projects: data.projects,
      revenue: data.revenue,
      expenses: data.expenses,
      profit: data.revenue - data.expenses,
    }));
  },

  /** Lead conversion funnel. */
  async leadConversion() {
    const grouped = await prisma.lead.groupBy({ by: ['status'], _count: { _all: true } });
    const total = grouped.reduce((acc, row) => acc + row._count._all, 0);
    const won = grouped.find((row) => row.status === 'WON')?._count._all ?? 0;
    const lost = grouped.find((row) => row.status === 'LOST')?._count._all ?? 0;

    return {
      stages: grouped.map((row) => ({ stage: row.status, count: row._count._all })),
      total,
      won,
      lost,
      conversionRate: total > 0 ? Number(((won / total) * 100).toFixed(2)) : 0,
    };
  },

  /** Team workload + logged time. */
  async teamWorkload(range: DateRange = {}) {
    const users = await prisma.user.findMany({
      where: { deletedAt: null, userRoles: { some: { role: { type: { not: 'CLIENT' } } } } },
      select: { id: true, firstName: true, lastName: true, jobTitle: true, status: true },
    });

    const timeEntries = await prisma.timeEntry.groupBy({
      by: ['userId'],
      _sum: { durationMinutes: true },
      where: {
        ...(range.from || range.to ? { startedAt: { gte: range.from, lte: range.to } } : {}),
      },
    });
    const openTasks = await prisma.task.groupBy({
      by: ['assigneeId'],
      _count: { _all: true },
      where: { status: { in: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED'] } },
    });

    const minutesMap = new Map(timeEntries.map((row) => [row.userId, row._sum.durationMinutes ?? 0]));
    const tasksMap = new Map(openTasks.map((row) => [row.assigneeId, row._count._all]));

    return users.map((user) => {
      const minutes = minutesMap.get(user.id) ?? 0;
      return {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`,
        jobTitle: user.jobTitle,
        status: user.status,
        openTasks: tasksMap.get(user.id) ?? 0,
        loggedHours: Number((minutes / 60).toFixed(2)),
      };
    });
  },

  /** Member earnings + payout history. */
  async memberEarnings(currency: string, range: DateRange = {}) {
    const earnings = await prisma.memberEarning.findMany({
      where: { currency, ...(range.from || range.to ? { createdAt: { gte: range.from, lte: range.to } } : {}) },
      include: {
        user: { select: { firstName: true, lastName: true } },
        project: { select: { projectNo: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    const payouts = await prisma.memberPayout.findMany({
      where: { currency, ...(range.from || range.to ? { createdAt: { gte: range.from, lte: range.to } } : {}) },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    return {
      earnings: earnings.map((earning) => ({
        member: `${earning.user.firstName} ${earning.user.lastName}`,
        project: earning.project.name,
        projectNo: earning.project.projectNo,
        model: earning.model,
        percent: earning.percent,
        amount: earning.amount,
        status: earning.status,
        ruleVersion: earning.ruleVersion,
        createdAt: earning.createdAt,
      })),
      payouts: payouts.map((payout) => ({
        payoutNo: payout.payoutNo,
        member: `${payout.user.firstName} ${payout.user.lastName}`,
        amount: payout.amount,
        status: payout.status,
        method: payout.method,
        reference: payout.reference,
        paidAt: payout.paidAt,
      })),
      totals: {
        accrued: earnings.reduce((acc, earning) => add(acc, earning.amount), ZERO),
        paid: payouts
          .filter((payout) => payout.status === 'PAID')
          .reduce((acc, payout) => add(acc, payout.amount), ZERO),
        pending: payouts
          .filter((payout) => payout.status !== 'PAID' && payout.status !== 'CANCELLED')
          .reduce((acc, payout) => add(acc, payout.amount), ZERO),
      },
    };
  },

  /** Support desk performance. */
  async supportPerformance(range: DateRange = {}) {
    const where: Prisma.TicketWhereInput = range.from || range.to
      ? { createdAt: { gte: range.from, lte: range.to } }
      : {};
    const tickets = await prisma.ticket.findMany({
      where,
      select: { id: true, ticketNo: true, subject: true, status: true, priority: true, createdAt: true, firstResponseAt: true, resolvedAt: true, assignedTo: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    const responseMinutes = tickets
      .filter((ticket) => ticket.firstResponseAt)
      .map((ticket) => (ticket.firstResponseAt!.getTime() - ticket.createdAt.getTime()) / 60000);
    const resolutionHours = tickets
      .filter((ticket) => ticket.resolvedAt)
      .map((ticket) => (ticket.resolvedAt!.getTime() - ticket.createdAt.getTime()) / 3600000);

    const avg = (values: number[]) => (values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : 0);

    return {
      total: tickets.length,
      open: tickets.filter((ticket) => ['OPEN', 'IN_PROGRESS', 'WAITING_CLIENT'].includes(ticket.status)).length,
      resolved: tickets.filter((ticket) => ['RESOLVED', 'CLOSED'].includes(ticket.status)).length,
      avgFirstResponseMinutes: avg(responseMinutes),
      avgResolutionHours: avg(resolutionHours),
      byPriority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => ({
        priority,
        count: tickets.filter((ticket) => ticket.priority === priority).length,
      })),
      tickets: tickets.slice(0, 200),
    };
  },

  /** Cash flow per month. */
  async cashFlow(currency: string, range: DateRange = {}) {
    const [payments, expenses, refunds] = await Promise.all([
      prisma.payment.findMany({
        where: { currency, isVoid: false, ...(range.from || range.to ? { paidAt: { gte: range.from, lte: range.to } } : {}) },
        select: { amount: true, paidAt: true },
      }),
      prisma.expense.findMany({
        where: { currency, status: { in: ['APPROVED', 'PAID'] }, ...(range.from || range.to ? { expenseDate: { gte: range.from, lte: range.to } } : {}) },
        select: { amount: true, taxAmount: true, expenseDate: true },
      }),
      // Refunds (and credit notes) are cash walking back out the door. The
      // dashboard subtracts them from the net operating result, so the cash
      // flow report must too - otherwise the two views disagree about how much
      // cash the business actually has.
      prisma.refund.findMany({
        where: { currency, ...(range.from || range.to ? { createdAt: { gte: range.from, lte: range.to } } : {}) },
        select: { amount: true, createdAt: true },
      }),
    ]);

    const months = new Map<string, { month: string; inflow: number; outflow: number; net: number }>();
    const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    for (const payment of payments) {
      const k = key(payment.paidAt);
      const entry = months.get(k) ?? { month: k, inflow: 0, outflow: 0, net: 0 };
      entry.inflow += dec(payment.amount).toNumber();
      entry.net = entry.inflow - entry.outflow;
      months.set(k, entry);
    }
    for (const expense of expenses) {
      const k = key(expense.expenseDate);
      const entry = months.get(k) ?? { month: k, inflow: 0, outflow: 0, net: 0 };
      entry.outflow += dec(add(expense.amount, expense.taxAmount)).toNumber();
      entry.net = entry.inflow - entry.outflow;
      months.set(k, entry);
    }
    for (const refund of refunds) {
      const k = key(refund.createdAt);
      const entry = months.get(k) ?? { month: k, inflow: 0, outflow: 0, net: 0 };
      entry.outflow += dec(refund.amount).toNumber();
      entry.net = entry.inflow - entry.outflow;
      months.set(k, entry);
    }

    return Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month));
  },

  /** Client history: lifetime value, projects, invoices. */
  async clientHistory(currency: string) {
    const clients = await prisma.client.findMany({
      where: { deletedAt: null },
      select: {
        id: true, companyName: true, firstName: true, lastName: true, status: true, createdAt: true,
        _count: { select: { projects: true, invoices: true, tickets: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const invoices = await prisma.invoice.groupBy({
      by: ['clientId'],
      _sum: { total: true, amountPaid: true, balance: true },
      where: { currency, status: { notIn: ['VOID', 'DRAFT'] } },
    });
    const invoiceMap = new Map(invoices.map((row) => [row.clientId, row._sum]));

    return clients.map((client) => {
      const sums = invoiceMap.get(client.id);
      return {
        id: client.id,
        name: client.companyName || `${client.firstName} ${client.lastName}`,
        status: client.status,
        projects: client._count.projects,
        invoices: client._count.invoices,
        tickets: client._count.tickets,
        lifetimeValue: sums?.total ?? ZERO,
        paid: sums?.amountPaid ?? ZERO,
        outstanding: sums?.balance ?? ZERO,
        clientSince: client.createdAt,
      };
    });
  },

  /** Revenue report grouped by month with invoice detail. */
  async revenueReport(currency: string, range: DateRange = {}) {
    const invoices = await prisma.invoice.findMany({
      where: { currency, status: { notIn: ['VOID'] }, ...invoiceDateFilter(range) },
      select: { invoiceNo: true, issueDate: true, status: true, total: true, amountPaid: true, balance: true, client: { select: { companyName: true, firstName: true, lastName: true } } },
      orderBy: { issueDate: 'desc' },
      take: 1000,
    });

    const byMonth = new Map<string, { month: string; invoiced: number; received: number; outstanding: number }>();
    for (const invoice of invoices) {
      const key = `${invoice.issueDate.getFullYear()}-${String(invoice.issueDate.getMonth() + 1).padStart(2, '0')}`;
      const entry = byMonth.get(key) ?? { month: key, invoiced: 0, received: 0, outstanding: 0 };
      entry.invoiced += dec(invoice.total).toNumber();
      entry.received += dec(invoice.amountPaid).toNumber();
      entry.outstanding += dec(invoice.balance).toNumber();
      byMonth.set(key, entry);
    }

    return {
      byMonth: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
      rows: invoices.map((invoice) => ({
        invoiceNo: invoice.invoiceNo,
        date: invoice.issueDate,
        client: invoice.client.companyName || `${invoice.client.firstName} ${invoice.client.lastName}`,
        status: invoice.status,
        total: invoice.total,
        received: invoice.amountPaid,
        outstanding: invoice.balance,
      })),
    };
  },

  /** Expense report grouped by category. */
  async expenseReport(currency: string, range: DateRange = {}) {
    const expenses = await prisma.expense.findMany({
      where: { currency, status: { in: ['APPROVED', 'PAID'] }, ...(range.from || range.to ? { expenseDate: { gte: range.from, lte: range.to } } : {}) },
      include: { category: { select: { name: true } }, project: { select: { name: true, projectNo: true } } },
      orderBy: { expenseDate: 'desc' },
      take: 1000,
    });

    const byCategory = new Map<string, number>();
    for (const expense of expenses) {
      const key = expense.category.name;
      byCategory.set(key, (byCategory.get(key) ?? 0) + dec(add(expense.amount, expense.taxAmount)).toNumber());
    }

    return {
      byCategory: Array.from(byCategory.entries()).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total),
      rows: expenses.map((expense) => ({
        expenseNo: expense.expenseNo,
        date: expense.expenseDate,
        category: expense.category.name,
        vendor: expense.vendor,
        project: expense.project?.name ?? null,
        amount: expense.amount,
        tax: expense.taxAmount,
        status: expense.status,
      })),
    };
  },
};
