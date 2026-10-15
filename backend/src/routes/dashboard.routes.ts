import { Router } from 'express';
import { prisma } from '../config/prisma';
import { DEFAULT_CURRENCY } from '../config/env';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';
import { getClientDashboard, getDashboard } from '../services/dashboardService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasPermission, requireClientAccount } from '../middleware/authorize';
import { parseDate } from '../utils/pagination';
import { ah, requireClientId } from './helpers';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

async function resolveCurrency(explicit?: unknown): Promise<string> {
  if (explicit) return String(explicit).toUpperCase();
  const settings = await prisma.companySetting.findUnique({ where: { id: 'default' } });
  return settings?.currency ?? DEFAULT_CURRENCY;
}

/**
 * Internal business dashboard. Client accounts transparently receive their own
 * scoped client dashboard instead of the company-wide view.
 */
dashboardRouter.get(
  '/',
  ah(async (req: AuthRequest, res) => {
    if (req.user!.isClient) {
      const clientId = requireClientId(req);
      const data = await getClientDashboard(clientId);
      return sendSuccess(res, data);
    }

    if (!hasPermission(req.user, 'dashboard.view')) {
      throw new AppError('You do not have permission to view the dashboard', 403);
    }

    const from = parseDate(req.query.dateFrom);
    const to = parseDate(req.query.dateTo);
    const currency = await resolveCurrency(req.query.currency);
    const data = await getDashboard(currency, from, to);
    return sendSuccess(res, data);
  }),
);

/** Explicit client-portal dashboard (client accounts only). */
dashboardRouter.get(
  '/client',
  requireClientAccount(),
  ah(async (req: AuthRequest, res) => {
    const clientId = requireClientId(req);
    const data = await getClientDashboard(clientId);
    return sendSuccess(res, data);
  }),
);
