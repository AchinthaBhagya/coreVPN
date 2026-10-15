import { Router } from 'express';
import { prisma } from '../config/prisma';
import { DEFAULT_CURRENCY } from '../config/env';
import { sendSuccess } from '../utils/apiResponse';
import { sendCsv } from '../utils/csv';
import { reportService } from '../services/reportService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { denyClients, requirePermission } from '../middleware/authorize';
import { parseDate } from '../utils/pagination';
import { ah } from './helpers';

export const reportsRouter = Router();

reportsRouter.use(authenticate, denyClients());

async function resolveCurrency(explicit?: unknown): Promise<string> {
  if (explicit) return String(explicit).toUpperCase();
  const settings = await prisma.companySetting.findUnique({ where: { id: 'default' } });
  return settings?.currency ?? DEFAULT_CURRENCY;
}

function range(req: AuthRequest) {
  return { from: parseDate(req.query.dateFrom), to: parseDate(req.query.dateTo) };
}

reportsRouter.get(
  '/invoice-aging',
  requirePermission('reports.finance'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.invoiceAging(currency);
    return sendSuccess(res, { currency, ...data });
  }),
);

reportsRouter.get(
  '/invoice-aging/export',
  requirePermission('reports.finance'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.invoiceAging(currency);
    return sendCsv(res, `invoice-aging-${new Date().toISOString().slice(0, 10)}.csv`, data.rows, [
      { header: 'Invoice', value: (row) => row.invoiceNo },
      { header: 'Client', value: (row) => row.client },
      { header: 'Due date', value: (row) => row.dueDate },
      { header: 'Status', value: (row) => row.status },
      { header: 'Total', value: (row) => row.total },
      { header: 'Balance', value: (row) => row.balance },
      { header: 'Days overdue', value: (row) => row.daysOverdue },
    ]);
  }),
);

reportsRouter.get(
  '/project-profitability',
  requirePermission('reports.finance'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.projectProfitability(currency, range(req));
    return sendSuccess(res, { currency, rows: data });
  }),
);

reportsRouter.get(
  '/project-profitability/export',
  requirePermission('reports.finance'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.projectProfitability(currency, range(req));
    return sendCsv(res, `project-profitability-${new Date().toISOString().slice(0, 10)}.csv`, data, [
      { header: 'Project', value: (row) => row.projectNo },
      { header: 'Name', value: (row) => row.name },
      { header: 'Client', value: (row) => row.client },
      { header: 'Status', value: (row) => row.status },
      { header: 'Invoiced', value: (row) => row.invoicedRevenue },
      { header: 'Cash received', value: (row) => row.cashReceived },
      { header: 'Expenses', value: (row) => row.expenses },
      { header: 'Profit', value: (row) => row.profit },
      { header: 'Margin %', value: (row) => row.marginPercent },
    ]);
  }),
);

reportsRouter.get(
  '/service-performance',
  requirePermission('reports.view'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.servicePerformance(currency, range(req));
    return sendSuccess(res, { currency, rows: data });
  }),
);

reportsRouter.get(
  '/lead-conversion',
  requirePermission('reports.view'),
  ah(async (_req: AuthRequest, res) => {
    const data = await reportService.leadConversion();
    return sendSuccess(res, data);
  }),
);

reportsRouter.get(
  '/team-workload',
  requirePermission('reports.team'),
  ah(async (req: AuthRequest, res) => {
    const data = await reportService.teamWorkload(range(req));
    return sendSuccess(res, { rows: data });
  }),
);

reportsRouter.get(
  '/member-earnings',
  requirePermission('reports.finance'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.memberEarnings(currency, range(req));
    return sendSuccess(res, { currency, ...data });
  }),
);

reportsRouter.get(
  '/support',
  requirePermission('reports.view'),
  ah(async (req: AuthRequest, res) => {
    const data = await reportService.supportPerformance(range(req));
    return sendSuccess(res, data);
  }),
);

reportsRouter.get(
  '/cash-flow',
  requirePermission('reports.finance'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.cashFlow(currency, range(req));
    return sendSuccess(res, { currency, rows: data });
  }),
);

reportsRouter.get(
  '/client-history',
  requirePermission('reports.view'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.clientHistory(currency);
    return sendSuccess(res, { currency, rows: data });
  }),
);

reportsRouter.get(
  '/client-history/export',
  requirePermission('reports.view'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.clientHistory(currency);
    return sendCsv(res, `client-history-${new Date().toISOString().slice(0, 10)}.csv`, data, [
      { header: 'Client', value: (row) => row.name },
      { header: 'Status', value: (row) => row.status },
      { header: 'Projects', value: (row) => row.projects },
      { header: 'Invoices', value: (row) => row.invoices },
      { header: 'Tickets', value: (row) => row.tickets },
      { header: 'Lifetime value', value: (row) => row.lifetimeValue },
      { header: 'Paid', value: (row) => row.paid },
      { header: 'Outstanding', value: (row) => row.outstanding },
      { header: 'Client since', value: (row) => row.clientSince },
    ]);
  }),
);

reportsRouter.get(
  '/revenue',
  requirePermission('reports.finance'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.revenueReport(currency, range(req));
    return sendSuccess(res, { currency, ...data });
  }),
);

reportsRouter.get(
  '/revenue/export',
  requirePermission('reports.finance'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.revenueReport(currency, range(req));
    return sendCsv(res, `revenue-${new Date().toISOString().slice(0, 10)}.csv`, data.rows, [
      { header: 'Invoice', value: (row) => row.invoiceNo },
      { header: 'Date', value: (row) => row.date },
      { header: 'Client', value: (row) => row.client },
      { header: 'Status', value: (row) => row.status },
      { header: 'Total', value: (row) => row.total },
      { header: 'Received', value: (row) => row.received },
      { header: 'Outstanding', value: (row) => row.outstanding },
    ]);
  }),
);

reportsRouter.get(
  '/expenses',
  requirePermission('reports.finance'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.expenseReport(currency, range(req));
    return sendSuccess(res, { currency, ...data });
  }),
);

reportsRouter.get(
  '/expenses/export',
  requirePermission('reports.finance'),
  ah(async (req: AuthRequest, res) => {
    const currency = await resolveCurrency(req.query.currency);
    const data = await reportService.expenseReport(currency, range(req));
    return sendCsv(res, `expenses-${new Date().toISOString().slice(0, 10)}.csv`, data.rows, [
      { header: 'Expense', value: (row) => row.expenseNo },
      { header: 'Date', value: (row) => row.date },
      { header: 'Category', value: (row) => row.category },
      { header: 'Vendor', value: (row) => row.vendor ?? '' },
      { header: 'Project', value: (row) => row.project ?? '' },
      { header: 'Amount', value: (row) => row.amount },
      { header: 'Tax', value: (row) => row.tax },
      { header: 'Status', value: (row) => row.status },
    ]);
  }),
);
