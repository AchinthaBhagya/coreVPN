import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { AppError } from '../utils/AppError';

export function hasPermission(user: AuthRequest['user'], permission: string): boolean {
  if (!user) return false;
  return user.permissions.includes(permission);
}

export function hasAnyPermission(user: AuthRequest['user'], permissions: string[]): boolean {
  if (!user) return false;
  if (user.permissions.includes('*')) return true;
  return permissions.some((permission) => user.permissions.includes(permission));
}

/** Requires the authenticated user to hold a specific permission. */
export function requirePermission(permission: string) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    if (!hasPermission(req.user, permission)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    return next();
  };
}

/** Requires at least one of the supplied permissions. */
export function requireAnyPermission(permissions: string[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    if (!hasAnyPermission(req.user, permissions)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }
    return next();
  };
}

/** Requires a specific role type, e.g. OWNER for security-critical settings. */
export function requireRoleType(...types: string[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    const ok = req.user.roles.some((role) => types.includes(role.type));
    if (!ok) return next(new AppError('Insufficient role level for this action', 403));
    return next();
  };
}

/** Blocks client (portal) accounts from internal-only endpoints entirely. */
export function denyClients() {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    if (req.user.isClient) return next(new AppError('Not available for client accounts', 403));
    return next();
  };
}

/** Restricts an endpoint to client (portal) accounts. */
export function requireClientAccount() {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required', 401));
    if (!req.user.isClient || !req.user.clientId) {
      return next(new AppError('Client portal account required', 403));
    }
    return next();
  };
}
