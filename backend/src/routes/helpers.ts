import { NextFunction, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../utils/AppError';
import { buildPaginationMeta } from '../utils/pagination';
import { sendPaginated } from '../utils/apiResponse';

type AsyncHandler = (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>;

/** Wraps an async route handler so rejected promises reach the error middleware. */
export const ah = (fn: AsyncHandler): RequestHandler => {
  return (req, res, next) => {
    fn(req as AuthRequest, res, next).catch(next);
  };
};

/* ----------------------------- Common schemas ----------------------------- */

export const idParamSchema = z.object({ id: z.string().min(1, 'A record id is required') });

export const currencySchema = z
  .string()
  .trim()
  .length(3, 'Currency must be a 3-letter code')
  .toUpperCase();

/** Accepts numbers or numeric strings and normalises to a string for Prisma.Decimal. */
export const moneySchema = z.union([z.number(), z.string()]).transform((value) => String(value));

export const optionalMoneySchema = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((value) => (value === null || value === undefined || value === '' ? undefined : String(value)));

/** Accepts an ISO date, Date object, or null. */
export const dateSchema = z.union([z.string(), z.date()]).transform((value) => new Date(value));

export const optionalDateSchema = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((value) => (value === null || value === undefined || value === '' ? undefined : new Date(value)));

export const nullableDateSchema = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return null;
    return new Date(value);
  });

export const lineItemSchema = z.object({
  description: z.string().min(1, 'Line description is required'),
  quantity: z.union([z.number(), z.string()]).default(1),
  unitPrice: z.union([z.number(), z.string()]),
  discount: z.union([z.number(), z.string()]).optional(),
  sortOrder: z.number().int().optional(),
});

/* ------------------------------ Access scoping ---------------------------- */

/** True when the authenticated account is a client-portal user. */
export function isClientUser(req: AuthRequest): boolean {
  return Boolean(req.user?.isClient);
}

/**
 * Ensures a client-portal user can only ever reach their own client record.
 * Internal users pass through. A client attempting to access another client's
 * data receives 404 (not 403) so record existence is not disclosed.
 */
export function assertClientScope(req: AuthRequest, clientId: string | null | undefined): void {
  if (!req.user) throw new AppError('Authentication required', 401);
  if (!req.user.isClient) return;
  if (!clientId || req.user.clientId !== clientId) {
    throw new AppError('Record not found', 404);
  }
}

/** Returns a Prisma `where` fragment that scopes a query to the caller. */
export function clientScope(req: AuthRequest): { clientId?: string } {
  if (req.user?.isClient && req.user.clientId) return { clientId: req.user.clientId };
  return {};
}

export function requireClientId(req: AuthRequest): string {
  if (!req.user?.clientId) throw new AppError('Client account is not linked to a client record', 403);
  return req.user.clientId;
}

/* ------------------------------ Response utils ---------------------------- */

export function sendList<T>(
  res: Response,
  items: T[],
  total: number,
  page: number,
  limit: number,
) {
  return sendPaginated(res, items, buildPaginationMeta(total, page, limit));
}

/** Parses a positive integer route/query value with a fallback. */
export function toInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function userDisplayName(user: { firstName: string; lastName: string } | null | undefined): string {
  if (!user) return 'System';
  return `${user.firstName} ${user.lastName}`.trim();
}
