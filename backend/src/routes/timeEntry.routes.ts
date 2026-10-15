import { Router } from 'express';
import { z } from 'zod';
import { Prisma, TimeEntryStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, sendList } from './helpers';

export const timeEntriesRouter = Router();

timeEntriesRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'startedAt', 'durationMinutes', 'status'];

const createSchema = z.object({
  projectId: z.string().min(1).nullable().optional(),
  taskId: z.string().min(1).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  startedAt: z.union([z.string(), z.date()]),
  endedAt: z.union([z.string(), z.date()]).nullable().optional(),
  durationMinutes: z.number().int().min(0).max(24 * 60).optional(),
  isBillable: z.boolean().optional(),
});

const startSchema = z.object({
  projectId: z.string().min(1).nullable().optional(),
  taskId: z.string().min(1).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  isBillable: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

const rejectSchema = z.object({ note: z.string().max(1000).nullable().optional() });

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

/** Recomputes stored actual hours for a task and its project from approved entries. */
async function syncActualHours(taskId: string | null, projectId: string | null): Promise<void> {
  if (taskId) {
    const agg = await prisma.timeEntry.aggregate({
      where: { taskId, status: 'APPROVED' },
      _sum: { durationMinutes: true },
    });
    await prisma.task
      .update({ where: { id: taskId }, data: { actualHours: new Prisma.Decimal((agg._sum.durationMinutes ?? 0) / 60) } })
      .catch(() => undefined);
  }
  if (projectId) {
    const agg = await prisma.timeEntry.aggregate({
      where: { projectId, status: 'APPROVED' },
      _sum: { durationMinutes: true },
    });
    await prisma.project
      .update({ where: { id: projectId }, data: { actualHours: new Prisma.Decimal((agg._sum.durationMinutes ?? 0) / 60) } })
      .catch(() => undefined);
  }
}

async function loadEntry(id: string) {
  const entry = await prisma.timeEntry.findUnique({ where: { id } });
  if (!entry) throw new AppError('Time entry not found', 404);
  return entry;
}

timeEntriesRouter.get(
  '/',
  requirePermission('time.viewAll'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'startedAt');
    const where: Prisma.TimeEntryWhereInput = {
      ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}),
      ...(req.query.taskId ? { taskId: String(req.query.taskId) } : {}),
      ...(req.query.userId ? { userId: String(req.query.userId) } : {}),
      ...(req.query.status ? { status: String(req.query.status) as TimeEntryStatus } : {}),
      ...(query.dateFrom || query.dateTo
        ? { startedAt: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lte: query.dateTo } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true, projectNo: true } },
          task: { select: { id: true, title: true } },
        },
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.timeEntry.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

timeEntriesRouter.get(
  '/mine',
  requirePermission('time.log'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const where: Prisma.TimeEntryWhereInput = {
      userId: req.user!.id,
      ...(req.query.status ? { status: String(req.query.status) as TimeEntryStatus } : {}),
      ...(query.dateFrom || query.dateTo
        ? { startedAt: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lte: query.dateTo } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        include: { project: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
        orderBy: { startedAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      prisma.timeEntry.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

/** Returns the currently running timer for the caller, if any. */
timeEntriesRouter.get(
  '/running',
  requirePermission('time.log'),
  ah(async (req: AuthRequest, res) => {
    const entry = await prisma.timeEntry.findFirst({
      where: { userId: req.user!.id, endedAt: null },
      include: { project: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
      orderBy: { startedAt: 'desc' },
    });
    return sendSuccess(res, entry);
  }),
);

timeEntriesRouter.post(
  '/',
  requirePermission('time.log'),
  validate(createSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof createSchema>;
    const startedAt = new Date(data.startedAt);
    const endedAt = data.endedAt ? new Date(data.endedAt) : null;
    if (endedAt && endedAt < startedAt) throw new AppError('End time cannot be before start time', 422);
    const duration = endedAt ? minutesBetween(startedAt, endedAt) : data.durationMinutes ?? 0;

    const entry = await prisma.timeEntry.create({
      data: {
        userId: req.user!.id,
        projectId: data.projectId ?? null,
        taskId: data.taskId ?? null,
        description: data.description ?? null,
        startedAt,
        endedAt,
        durationMinutes: duration,
        isBillable: data.isBillable ?? true,
        status: 'DRAFT',
      },
    });
    return sendCreated(res, entry);
  }),
);

timeEntriesRouter.post(
  '/start',
  requirePermission('time.log'),
  validate(startSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof startSchema>;
    const running = await prisma.timeEntry.findFirst({ where: { userId: req.user!.id, endedAt: null } });
    if (running) throw new AppError('You already have a running timer. Stop it before starting a new one.', 409);

    const entry = await prisma.timeEntry.create({
      data: {
        userId: req.user!.id,
        projectId: data.projectId ?? null,
        taskId: data.taskId ?? null,
        description: data.description ?? null,
        startedAt: new Date(),
        durationMinutes: 0,
        isBillable: data.isBillable ?? true,
        status: 'DRAFT',
      },
    });
    return sendCreated(res, entry);
  }),
);

timeEntriesRouter.post(
  '/:id/stop',
  requirePermission('time.log'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const entry = await loadEntry(req.params.id);
    if (entry.userId !== req.user!.id) throw new AppError('You can only stop your own timer', 403);
    if (entry.endedAt) throw new AppError('This timer has already been stopped', 409);

    const endedAt = new Date();
    const updated = await prisma.timeEntry.update({
      where: { id: entry.id },
      data: { endedAt, durationMinutes: minutesBetween(entry.startedAt, endedAt) },
    });
    return sendSuccess(res, updated, { message: 'Timer stopped' });
  }),
);

timeEntriesRouter.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof updateSchema>;
    const entry = await loadEntry(req.params.id);
    const canManageAll = req.user!.permissions.includes('time.approve');
    if (entry.userId !== req.user!.id && !canManageAll) throw new AppError('Not permitted', 403);
    if (entry.userId === req.user!.id && !['DRAFT', 'REJECTED'].includes(entry.status)) {
      throw new AppError('Only draft or rejected entries can be edited', 409);
    }

    const startedAt = data.startedAt ? new Date(data.startedAt) : entry.startedAt;
    const endedAt = data.endedAt !== undefined ? (data.endedAt ? new Date(data.endedAt) : null) : entry.endedAt;
    const duration = endedAt ? minutesBetween(startedAt, endedAt) : data.durationMinutes ?? entry.durationMinutes;

    const updated = await prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
        ...(data.taskId !== undefined ? { taskId: data.taskId } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        startedAt,
        endedAt,
        durationMinutes: duration,
        ...(data.isBillable !== undefined ? { isBillable: data.isBillable } : {}),
      },
    });
    return sendSuccess(res, updated);
  }),
);

timeEntriesRouter.delete(
  '/:id',
  requirePermission('time.log'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const entry = await loadEntry(req.params.id);
    const canManageAll = req.user!.permissions.includes('time.approve');
    if (entry.userId !== req.user!.id && !canManageAll) throw new AppError('Not permitted', 403);
    if (entry.status === 'APPROVED' && !canManageAll) throw new AppError('Approved entries cannot be deleted', 409);
    await prisma.timeEntry.delete({ where: { id: entry.id } });
    return sendNoContent(res);
  }),
);

timeEntriesRouter.post(
  '/:id/submit',
  requirePermission('time.log'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const entry = await loadEntry(req.params.id);
    if (entry.userId !== req.user!.id) throw new AppError('You can only submit your own entries', 403);
    if (!['DRAFT', 'REJECTED'].includes(entry.status)) throw new AppError('This entry cannot be submitted', 409);
    const updated = await prisma.timeEntry.update({ where: { id: entry.id }, data: { status: 'SUBMITTED' } });
    return sendSuccess(res, updated, { message: 'Time entry submitted for approval' });
  }),
);

timeEntriesRouter.post(
  '/:id/approve',
  requirePermission('time.approve'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const entry = await loadEntry(req.params.id);
    const updated = await prisma.timeEntry.update({
      where: { id: entry.id },
      data: { status: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date(), rejectionNote: null },
    });
    await syncActualHours(updated.taskId, updated.projectId);
    await writeAudit(req, { action: 'time.approve', module: 'time', entityId: entry.id });
    return sendSuccess(res, updated, { message: 'Time entry approved' });
  }),
);

timeEntriesRouter.post(
  '/:id/reject',
  requirePermission('time.approve'),
  validate(idParamSchema, 'params'),
  validate(rejectSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof rejectSchema>;
    const entry = await loadEntry(req.params.id);
    const updated = await prisma.timeEntry.update({
      where: { id: entry.id },
      data: { status: 'REJECTED', approvedById: req.user!.id, approvedAt: new Date(), rejectionNote: data.note ?? null },
    });
    await syncActualHours(updated.taskId, updated.projectId);
    return sendSuccess(res, updated, { message: 'Time entry rejected' });
  }),
);
