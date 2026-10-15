import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sha256 } from '../utils/token';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  avatarId: string | null;
  jobTitle: string | null;
  permissions: string[];
  roles: Array<{ id: string; name: string; type: string }>;
  isClient: boolean;
  clientId: string | null;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

/**
 * Authenticates the request from the HTTP-only session cookie.
 * Sessions are opaque random tokens; only a SHA-256 hash is stored so a
 * database leak cannot be replayed as a login.
 */
export async function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const rawToken: string | undefined = req.cookies?.sid;
    if (!rawToken) {
      return next(new AppError('Authentication required', 401));
    }

    const tokenHash = sha256(rawToken);
    const session = await prisma.session.findUnique({
      where: { token: tokenHash },
      include: {
        user: {
          include: {
            client: { select: { id: true } },
            userRoles: {
              include: {
                role: {
                  include: {
                    rolePermissions: { include: { permission: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session || session.expiresAt.getTime() < Date.now()) {
      if (session) {
        await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      }
      return next(new AppError('Session expired. Please sign in again.', 401));
    }

    const user = session.user;
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      return next(new AppError('Account is not active', 403));
    }

    const permissions = Array.from(
      new Set(
        user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.name)),
      ),
    );
    const roles = user.userRoles.map((ur) => ({ id: ur.role.id, name: ur.role.name, type: ur.role.type }));
    const isClient = roles.some((role) => role.type === 'CLIENT');

    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      avatarId: user.avatarId,
      jobTitle: user.jobTitle,
      permissions,
      roles,
      isClient,
      clientId: user.client?.id ?? null,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/** Optional authentication - used for endpoints that behave differently when signed in. */
export async function optionalAuthenticate(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.cookies?.sid) return next();
  return authenticate(req, res, (err) => next(err));
}
