import { Response } from 'express';
import { serialize } from './serialize';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Consistent API envelope. Every response from the API uses this shape:
 * { success: boolean, data?: T, message?: string, meta?: {...}, errors?: [...] }
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  options: { status?: number; message?: string; meta?: Record<string, unknown> } = {},
) {
  const { status = 200, message, meta } = options;
  return res.status(status).json({
    success: true,
    ...(message ? { message } : {}),
    data: serialize(data),
    ...(meta ? { meta: serialize(meta) } : {}),
  });
}

export function sendCreated<T>(res: Response, data: T, message = 'Created successfully') {
  return sendSuccess(res, data, { status: 201, message });
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  pagination: PaginationMeta,
  message?: string,
) {
  return res.status(200).json({
    success: true,
    ...(message ? { message } : {}),
    data: serialize(items),
    meta: serialize({ pagination }),
  });
}

export function sendNoContent(res: Response) {
  return res.status(204).send();
}
