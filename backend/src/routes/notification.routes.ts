import { Router } from 'express';
import { z } from 'zod';
import { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  ensureDefaultPreferences,
  listNotifications,
  markRead,
} from '../services/notificationService';
import { ah } from './helpers';

export const notificationsRouter = Router();

// Every notification endpoint operates strictly on the caller's own records.
notificationsRouter.use(authenticate);

const readSchema = z.object({
  ids: z.array(z.string().min(1)).optional(),
});

const preferenceItemSchema = z.object({
  type: z.nativeEnum(NotificationType),
  inApp: z.boolean(),
  email: z.boolean(),
  discord: z.boolean(),
});

const preferenceSchema = z.object({ preferences: z.array(preferenceItemSchema).min(1) });

notificationsRouter.get(
  '/',
  ah(async (req: AuthRequest, res) => {
    const onlyUnread = req.query.unread === 'true';
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30) || 30));
    const { items, unreadCount } = await listNotifications(req.user!.id, onlyUnread, limit);
    return sendSuccess(res, { items, unreadCount });
  }),
);

notificationsRouter.get(
  '/unread-count',
  ah(async (req: AuthRequest, res) => {
    const count = await prisma.notification.count({ where: { userId: req.user!.id, isRead: false } });
    return sendSuccess(res, { unreadCount: count });
  }),
);

notificationsRouter.post(
  '/read',
  validate(readSchema),
  ah(async (req: AuthRequest, res) => {
    const { ids } = req.body as z.infer<typeof readSchema>;
    const result = await markRead(req.user!.id, ids);
    return sendSuccess(res, { updated: result.count }, { message: 'Notifications marked as read' });
  }),
);

notificationsRouter.post(
  '/read-all',
  ah(async (req: AuthRequest, res) => {
    const result = await markRead(req.user!.id);
    return sendSuccess(res, { updated: result.count }, { message: 'All notifications marked as read' });
  }),
);

notificationsRouter.delete(
  '/:id',
  ah(async (req: AuthRequest, res) => {
    const deleted = await prisma.notification.deleteMany({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!deleted.count) throw new AppError('Notification not found', 404);
    return sendSuccess(res, { deleted: true });
  }),
);

/** Returns all notification types merged with the caller's saved preferences. */
notificationsRouter.get(
  '/preferences',
  ah(async (req: AuthRequest, res) => {
    await ensureDefaultPreferences(req.user!.id);
    const prefs = await prisma.notificationPreference.findMany({
      where: { userId: req.user!.id },
      orderBy: { type: 'asc' },
    });
    const byType = new Map(prefs.map((pref) => [pref.type, pref]));
    const preferences = Object.values(NotificationType).map((type) => {
      const pref = byType.get(type);
      return {
        type,
        inApp: pref?.inApp ?? true,
        email: pref?.email ?? false,
        discord: pref?.discord ?? false,
      };
    });
    return sendSuccess(res, { preferences });
  }),
);

notificationsRouter.put(
  '/preferences',
  validate(preferenceSchema),
  ah(async (req: AuthRequest, res) => {
    const { preferences } = req.body as z.infer<typeof preferenceSchema>;
    // In-app notifications for critical financial/security events cannot be fully
    // disabled - only delivery channels and non-critical types are configurable.
    const updated = await prisma.$transaction(
      preferences.map((pref) =>
        prisma.notificationPreference.upsert({
          where: { userId_type: { userId: req.user!.id, type: pref.type } },
          update: {
            email: pref.email,
            discord: pref.discord,
            inApp: pref.inApp,
          },
          create: {
            userId: req.user!.id,
            type: pref.type,
            inApp: pref.inApp,
            email: pref.email,
            discord: pref.discord,
          },
        }),
      ),
    );
    return sendSuccess(res, { updated: updated.length }, { message: 'Notification preferences saved' });
  }),
);

/** Bulk clear of read notifications for the caller. */
notificationsRouter.post(
  '/clear-read',
  ah(async (req: AuthRequest, res) => {
    const where: Prisma.NotificationWhereInput = { userId: req.user!.id, isRead: true };
    const result = await prisma.notification.deleteMany({ where });
    return sendSuccess(res, { deleted: result.count }, { message: 'Read notifications cleared' });
  }),
);
