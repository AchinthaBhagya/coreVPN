import { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import logger from '../config/logger';
import { discordService } from './discordService';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  /** When supplied, duplicate notifications for the same key are suppressed. */
  dedupeKey?: string;
}

/**
 * Creates an in-app notification. Notifications never perform financial or
 * state-changing actions automatically - they only inform.
 */
export async function createNotification(input: CreateNotificationInput) {
  try {
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId_type: { userId: input.userId, type: input.type } },
    });

    if (pref && !pref.inApp) {
      return null;
    }

    return await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupeKey: input.dedupeKey,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Duplicate notification suppressed by dedupeKey
      return null;
    }
    logger.error('Failed to create notification', { error, input });
    return null;
  }
}

export async function notifyUsers(inputs: CreateNotificationInput[]) {
  return Promise.all(inputs.map((input) => createNotification(input)));
}

export async function notifyPermissionHolders(
  permission: string,
  input: Omit<CreateNotificationInput, 'userId'>,
  options: { discordEvent?: string } = {},
) {
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      userRoles: {
        some: { role: { rolePermissions: { some: { permission: { name: permission } } } } },
      },
    },
    select: { id: true },
  });

  await notifyUsers(users.map((user) => ({ ...input, userId: user.id })));

  if (options.discordEvent) {
    void discordService.dispatch(options.discordEvent, { content: `**${input.title}**\n${input.message ?? ''}` });
  }
}

export async function listNotifications(userId: string, onlyUnread: boolean, limit: number) {
  const where: Prisma.NotificationWhereInput = { userId, ...(onlyUnread ? { isRead: false } : {}) };
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  return { items, unreadCount };
}

export async function markRead(userId: string, ids?: string[]) {
  return prisma.notification.updateMany({
    where: { userId, ...(ids && ids.length ? { id: { in: ids } } : { isRead: false }) },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function ensureDefaultPreferences(userId: string) {
  const types = Object.values(NotificationType);
  await Promise.all(
    types.map((type) =>
      prisma.notificationPreference.upsert({
        where: { userId_type: { userId, type } },
        update: {},
        create: { userId, type, inApp: true, email: false, discord: false },
      }),
    ),
  );
}
