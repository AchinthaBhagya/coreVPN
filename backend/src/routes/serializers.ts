import { AuthUser } from '../middleware/auth';

export interface UserWithRoles {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  jobTitle?: string | null;
  status: string;
  avatarId?: string | null;
  lastLogin?: Date | null;
  createdAt?: Date;
  client?: { id: string } | null;
  userRoles: Array<{
    role: {
      id: string;
      name: string;
      type: string;
      rolePermissions: Array<{ permission: { name: string } }>;
    };
  }>;
}

/** Builds the safe, permission-aware shape returned to an authenticated user. */
export function toAuthUser(user: UserWithRoles): AuthUser {
  const permissions = Array.from(
    new Set(user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.name))),
  );
  const roles = user.userRoles.map((ur) => ({ id: ur.role.id, name: ur.role.name, type: ur.role.type }));
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    status: user.status,
    avatarId: user.avatarId ?? null,
    jobTitle: user.jobTitle ?? null,
    permissions,
    roles,
    isClient: roles.some((role) => role.type === 'CLIENT'),
    clientId: user.client?.id ?? null,
  };
}

/** Includes needed to resolve a user's roles + permissions. */
export const userAccessInclude = {
  client: { select: { id: true } },
  userRoles: {
    include: {
      role: {
        include: { rolePermissions: { include: { permission: true } } },
      },
    },
  },
} as const;
