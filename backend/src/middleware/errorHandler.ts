import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/AppError';
import { env } from '../config/env';
import logger from '../config/logger';

export function notFoundHandler(req: Request, res: Response) {
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

interface ErrorWithExtras extends Error {
  statusCode?: number;
  status?: string;
  isOperational?: boolean;
  errors?: unknown;
  code?: string;
  type?: string;
}

/** Centralised error handling. Never leaks stack traces or internals in production. */
export function errorHandler(
  err: ErrorWithExtras,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  let statusCode = err.statusCode ?? 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.errors;

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        statusCode = 409;
        const target = (err.meta?.target as string[] | string | undefined) ?? 'field';
        message = `A record with this ${Array.isArray(target) ? target.join(', ') : target} already exists.`;
        break;
      }
      case 'P2003':
        statusCode = 400;
        message = 'Related record not found or still referenced.';
        break;
      case 'P2025':
        statusCode = 404;
        message = 'Record not found.';
        break;
      default:
        statusCode = 400;
        message = 'Database request could not be completed.';
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400;
    message = 'Invalid data supplied to the database layer.';
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Invalid or expired authentication token.';
  }

  if (err.name === 'MulterError') {
    statusCode = 400;
    message = message || 'File upload rejected.';
  }

  const isOperational = err instanceof AppError || statusCode < 500;

  if (statusCode >= 500) {
    logger.error('Unhandled request error', {
      message: err.message,
      stack: err.stack,
      method: req.method,
      url: req.originalUrl,
    });
  } else {
    logger.warn('Request rejected', {
      message: err.message,
      method: req.method,
      url: req.originalUrl,
      statusCode,
    });
  }

  return res.status(statusCode).json({
    success: false,
    message: isOperational && (env.isProduction ? err instanceof AppError : true) ? message : 'Internal Server Error',
    ...(errors ? { errors } : {}),
    ...(env.isProduction ? {} : { stack: err.stack }),
  });
}
