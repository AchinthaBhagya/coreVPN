import { Router } from 'express';
import { z } from 'zod';
import { Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { createNotification } from '../services/notificationService';
import { hasPermission, requirePermission, denyClients } from '../middleware/authorize';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, optionalDateSchema, optionalMoneySchema, sendList } from './helpers';

export const tasksRouter = Router();

tasksRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'updatedAt', 'title', 'dueDate', 'status', 'priority', 'sortOrder'];

const taskBodySchema = z.object({
  projectId: z.string().min(1).nullable().optional(),
  parentTaskId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000).nullable().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  startDate: optionalDateSchema,
  dueDate: optionalDateSchema,
  estimatedHours: optionalMoneySchema,
  labels: z.array(z.string().trim().max(40)).optional(),
  sortOrder: z.number().int().optional(),
});

const taskUpdateSchema = taskBodySchema.partial();

const commentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  isInternal: z.boolean().optional(),
});

/** Recomputes a project's progress from its task completion ratio. */
async function recalcProjectProgress(projectId: string | null): Promise<void> {
  if (!projectId) return;
  const [total, done] = await Promise.all([
    prisma.task.count({ where: { projectId, deletedAt: null, status: { notIn: ['CANCELLED'] } } }),
    prisma.task.count({ where: { projectId, deletedAt: null, status: 'DONE' } }),
  ]);
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);
  await prisma.project.update({ where: { id: projectId }, data: { progress } }).catch(() => undefined);
}

function taskAccessWhere(req: AuthRequest): Prisma.TaskWhereInput {
  if (hasPermission(req.user, 'projects.viewAll') || hasPermission(req.user, 'tasks.delete')) return {};
  return {
    OR: [
      { assigneeId: req.user!.id },
      { reporterId: req.user!.id },
      { project: { members: { some: { userId: req.user!.id } } } },
      { project: { managerId: req.user!.id } },
    ],
  };
}

tasksRouter.get(
  '/',
  requirePermission('tasks.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'createdAt');
    const where: Prisma.TaskWhereInput = {
      deletedAt: null,
      AND: [
        taskAccessWhere(req),
        {
          ...(query.search ? { OR: [{ title: { contains: query.search } }, { description: { contains: query.search } }] } : {}),
          ...(req.query.status ? { status: String(req.query.status) as TaskStatus } : {}),
          ...(req.query.priority ? { priority: String(req.query.priority) as TaskPriority } : {}),
          ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}),
          ...(req.query.assigneeId ? { assigneeId: String(req.query.assigneeId) } : {}),
          ...(req.query.parentTaskId ? { parentTaskId: String(req.query.parentTaskId) } : {}),
          ...(req.query.overdue === 'true' ? { dueDate: { lt: new Date() }, status: { notIn: ['DONE', 'CANCELLED'] } } : {}),
        },
      ],
    };
    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true } },
          project: { select: { id: true, name: true, projectNo: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
        orderBy: [{ [sortBy]: query.sortDir }],
        skip: query.skip,
        take: query.take,
      }),
      prisma.task.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

tasksRouter.post(
  '/',
  requirePermission('tasks.create'),
  validate(taskBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof taskBodySchema>;
    if (data.projectId) {
      const project = await prisma.project.findFirst({ where: { id: data.projectId, deletedAt: null } });
      if (!project) throw new AppError('Project not found', 404);
    }
    const task = await prisma.task.create({
      data: {
        projectId: data.projectId ?? null,
        parentTaskId: data.parentTaskId ?? null,
        title: data.title,
        description: data.description ?? null,
        status: data.status ?? 'TODO',
        priority: data.priority ?? 'MEDIUM',
        assigneeId: data.assigneeId ?? null,
        reporterId: req.user!.id,
        startDate: data.startDate ?? null,
        dueDate: data.dueDate ?? null,
        estimatedHours: data.estimatedHours ?? null,
        labels: data.labels ? (data.labels as Prisma.InputJsonValue) : undefined,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    if (task.assigneeId && task.assigneeId !== req.user!.id) {
      await createNotification({
        userId: task.assigneeId,
        type: 'TASK_ASSIGNED',
        title: 'New task assigned',
        message: task.title,
        entityType: 'Task',
        entityId: task.id,
        link: `/tasks/${task.id}`,
        dedupeKey: `task-assigned:${task.id}:${task.assigneeId}`,
      });
    }
    await recalcProjectProgress(task.projectId);
    return sendCreated(res, task);
  }),
);

tasksRouter.get(
  '/:id',
  requirePermission('tasks.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
        reporter: { select: { id: true, firstName: true, lastName: true } },
        project: { select: { id: true, name: true, projectNo: true } },
        subtasks: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        comments: { include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'asc' } },
        checklist: { orderBy: { sortOrder: 'asc' } },
        dependencies: { include: { dependsOnTask: { select: { id: true, title: true, status: true } } } },
        attachments: { where: { deletedAt: null } },
      },
    });
    if (!task) throw new AppError('Task not found', 404);
    return sendSuccess(res, task);
  }),
);

tasksRouter.patch(
  '/:id',
  requirePermission('tasks.update'),
  validate(idParamSchema, 'params'),
  validate(taskUpdateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof taskUpdateSchema>;
    const existing = await prisma.task.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!existing) throw new AppError('Task not found', 404);

    const task = await prisma.task.update({
      where: { id: existing.id },
      data: {
        ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
        ...(data.parentTaskId !== undefined ? { parentTaskId: data.parentTaskId } : {}),
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.status !== undefined
          ? { status: data.status, completedAt: data.status === 'DONE' ? new Date() : null }
          : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}),
        ...(data.startDate !== undefined ? { startDate: data.startDate ?? null } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate ?? null } : {}),
        ...(data.estimatedHours !== undefined ? { estimatedHours: data.estimatedHours } : {}),
        ...(data.labels !== undefined ? { labels: data.labels as Prisma.InputJsonValue } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });

    if (data.assigneeId && data.assigneeId !== existing.assigneeId && data.assigneeId !== req.user!.id) {
      await createNotification({
        userId: data.assigneeId,
        type: 'TASK_ASSIGNED',
        title: 'Task assigned to you',
        message: task.title,
        entityType: 'Task',
        entityId: task.id,
        link: `/tasks/${task.id}`,
        dedupeKey: `task-assigned:${task.id}:${data.assigneeId}:${Date.now()}`,
      });
    }
    await recalcProjectProgress(task.projectId);
    return sendSuccess(res, task, { message: 'Task updated' });
  }),
);

tasksRouter.delete(
  '/:id',
  requirePermission('tasks.delete'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.task.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!existing) throw new AppError('Task not found', 404);
    await prisma.task.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    await writeAudit(req, { action: 'task.delete', module: 'tasks', entityId: existing.id });
    await recalcProjectProgress(existing.projectId);
    return sendNoContent(res);
  }),
);

tasksRouter.post(
  '/:id/comments',
  requirePermission('tasks.update'),
  validate(idParamSchema, 'params'),
  validate(commentSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof commentSchema>;
    const task = await prisma.task.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!task) throw new AppError('Task not found', 404);
    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: req.user!.id,
        body: data.body,
        isInternal: data.isInternal ?? true,
      },
    });
    if (task.assigneeId && task.assigneeId !== req.user!.id) {
      await createNotification({
        userId: task.assigneeId,
        type: 'TASK_ASSIGNED',
        title: 'New comment on your task',
        message: task.title,
        entityType: 'Task',
        entityId: task.id,
        link: `/tasks/${task.id}`,
      });
    }
    return sendCreated(res, comment);
  }),
);

tasksRouter.post(
  '/:id/dependencies',
  requirePermission('tasks.update'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const dependsOnTaskId = String(req.body?.dependsOnTaskId ?? '');
    if (!dependsOnTaskId) throw new AppError('dependsOnTaskId is required', 422);
    const [task, dependency] = await Promise.all([
      prisma.task.findFirst({ where: { id: req.params.id, deletedAt: null } }),
      prisma.task.findFirst({ where: { id: dependsOnTaskId, deletedAt: null } }),
    ]);
    if (!task || !dependency) throw new AppError('Task not found', 404);
    if (task.id === dependency.id) throw new AppError('A task cannot depend on itself', 422);

    const created = await prisma.taskDependency.create({
      data: { taskId: task.id, dependsOnTaskId: dependency.id },
    });
    return sendCreated(res, created);
  }),
);

tasksRouter.delete(
  '/:id/dependencies/:dependencyId',
  requirePermission('tasks.update'),
  ah(async (req: AuthRequest, res) => {
    const deleted = await prisma.taskDependency.deleteMany({
      where: { id: req.params.dependencyId, taskId: req.params.id },
    });
    if (!deleted.count) throw new AppError('Dependency not found', 404);
    return sendNoContent(res);
  }),
);
