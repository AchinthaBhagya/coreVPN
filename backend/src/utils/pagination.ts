import { Request } from 'express';
import { PaginationMeta } from './apiResponse';

export interface ListQuery {
  page: number;
  limit: number;
  skip: number;
  take: number;
  search: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  dateFrom?: Date;
  dateTo?: Date;
}

const MAX_LIMIT = 200;

export function parseListQuery(req: Request, defaultSortBy = 'createdAt'): ListQuery {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit ?? 20) || 20));
  const sortBy = typeof req.query.sortBy === 'string' && req.query.sortBy ? req.query.sortBy : defaultSortBy;
  const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  const dateFrom = parseDate(req.query.dateFrom);
  const dateTo = parseDate(req.query.dateTo);

  return { page, limit, skip: (page - 1) * limit, take: limit, search, sortBy, sortDir, dateFrom, dateTo };
}

export function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/** Whitelists a sort field to prevent injection / invalid keys. */
export function safeSortField(field: string, allowed: string[], fallback: string): string {
  return allowed.includes(field) ? field : fallback;
}
