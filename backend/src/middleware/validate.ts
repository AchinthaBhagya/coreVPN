import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError, ZodTypeAny } from 'zod';
import { AppError } from '../utils/AppError';

type Source = 'body' | 'query' | 'params';

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Validates and coerces request input with Zod. Parsed output replaces the raw
 * input so downstream handlers only ever see validated data.
 */
export function validate(schema: AnyZodObject | ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const err = new AppError('Validation failed', 422);
      (err as AppError & { errors?: unknown }).errors = formatZodError(result.error);
      return next(err);
    }
    if (source === 'query') {
      Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
    } else {
      (req as unknown as Record<string, unknown>)[source] = result.data;
    }
    return next();
  };
}

/** Validates multiple sources at once, e.g. { body, params }. */
export function validateRequest(schemas: Partial<Record<Source, AnyZodObject | ZodTypeAny>>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const source of Object.keys(schemas) as Source[]) {
      const schema = schemas[source];
      if (!schema) continue;
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        const err = new AppError('Validation failed', 422);
        (err as AppError & { errors?: unknown }).errors = formatZodError(result.error);
        return next(err);
      }
      if (source === 'query') {
        Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
      } else {
        (req as unknown as Record<string, unknown>)[source] = result.data;
      }
    }
    return next();
  };
}
