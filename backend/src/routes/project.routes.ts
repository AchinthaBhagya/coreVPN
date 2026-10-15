import { Router } from 'express';
import { z } from 'zod';
import { MilestoneStatus, Prisma, ProjectPriority, ProjectStatus, RevisionStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { logActivity } from '../services/activityService';
import { createNotification, notifyUsers } from '../services/notificationService';
import { numbering } from '../services/numberingService';
import { computeProjectFinancials } from '../services/financeService';
import { hasPermission, requirePermission, denyClients } from '../middleware/authorize';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, optionalDateSchema, optionalMoneySchema, sendList } from './helpers';

export const projectsRouter = Router();

projectsRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'updatedAt', 'name', 'deadline', 'status', 'priority', 'progress'];

const projectBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  clientId: z.string().min(1),
  serviceId: z.string().min(1).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  managerId: z.string().min(1).nullable().optional(),
  budget: optionalMoneySchema,
  currency: z.string().length(3).toUpperCase().optional(),
  startDate: optionalDateSchema,
  deadline: optionalDateSchema,
  priority: z.nativeEnum(ProjectPriority).optional(),
  status: z.nativeEnum(ProjectStatus).optional(),
  estimatedHours: optionalMoneySchema,
  progress: z.number().int().min(0).max(100).optional(),
  internalNotes: z.string().max(10000).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).optional(),
});

const projectUpdateBodySchema = projectBodySchema.partial();

const milestoneSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  dueDate: optionalDateSchema,
  status: z.nativeEnum(MilestoneStatus).optional(),
  isClientVisible: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const updatePostSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(1).max(10000),
  isClientVisible: z.boolean().optional(),
});

const revisionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
});

const revisionUpdateSchema = z.object({
  status: z.nativeEnum(RevisionStatus).optional(),
  response: z.string().max(5000).nullable().optional(),
});

const checklistSchema = z.object({
  title: z.string().trim().min(1).max(300),
  isDone: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

type ProjectRow = Prisma.ProjectGetPayload<{ include: { members: true } }>;

/** Internal users with projects.viewAll see everything; others only their projects. */
function projectAccessWhere(req: AuthRequest): Prisma.ProjectWhereInput {
  if (hasPermission(req.user, 'projects.viewAll')) return {};
  return {
    OR: [{ managerId: req.user!.id }, { members: { some: { userId: req.user!.id } } }],
  };
}

async function loadAccessibleProject(req: AuthRequest, id: string): Promise<ProjectRow> {
  const project = await prisma.project.findFirst({
    where: { id, deletedAt: null },
    include: { members: true },
  });
  if (!project) throw new AppError('Project not found', 404);
  if (hasPermission(req.user, 'projects.viewAll')) return project;
  const isMember = project.managerId === req.user!.id || project.members.some((m) => m.userId === req.user!.id);
  if (!isMember) throw new AppError('Project not found', 404);
  return project;
}

projectsRouter.get(
  '/',
  requirePermission('projects.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'createdAt');
    const where: Prisma.ProjectWhereInput = {
      deletedAt: null,
      AND: [
        projectAccessWhere(req),
        {
          ...(query.search ? { OR: [{ name: { contains: query.search } }, { projectNo: { contains: query.search } }] } : {}),
          ...(req.query.status ? { status: String(req.query.status) as ProjectStatus } : {}),
          ...(req.query.clientId ? { clientId: String(req.query.clientId) } : {}),
          ...(req.query.managerId ? { managerId: String(req.query.managerId) } : {}),
          ...(req.query.priority ? { priority: String(req.query.priority) as ProjectPriority } : {}),
        },
      ],
    };
    const [items, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: {
          client: { select: { id: true, companyName: true, firstName: true, lastName: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { tasks: true, milestones: true, members: true } },
        },
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.project.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

projectsRouter.post(
  '/',
  requirePermission('projects.create'),
  validate(projectBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof projectBodySchema>;
    const client = await prisma.client.findFirst({ where: { id: data.clientId, deletedAt: null } });
    if (!client) throw new AppError('Client not found', 404);

    const project = await prisma.$transaction(async (tx) => {
      const projectNo = await numbering.projectNumber(tx);
      const created = await tx.project.create({
        data: {
          projectNo,
          name: data.name,
          clientId: client.id,
          serviceId: data.serviceId ?? null,
          description: data.description ?? null,
          managerId: data.managerId ?? req.user!.id,
          budget: data.budget ?? '0',
          currency: data.currency ?? client.currency,
          startDate: data.startDate ?? null,
          deadline: data.deadline ?? null,
          priority: data.priority ?? 'MEDIUM',
          status: data.status ?? 'PLANNING',
          estimatedHours: data.estimatedHours ?? null,
          progress: data.progress ?? 0,
          internalNotes: data.internalNotes ?? null,
          tags: data.tags ? (data.tags as Prisma.InputJsonValue) : undefined,
          createdById: req.user!.id,
          members: { create: [{ userId: data.managerId ?? req.user!.id, role: 'Manager' }] },
        },
      });
      return created;
    });

    await logActivity({
      actorId: req.user!.id,
      action: 'project.created',
      entityType: 'Project',
      entityId: project.id,
      projectId: project.id,
      clientId: project.clientId,
      summary: `Project ${project.name} created`,
      isClientVisible: true,
    });
    await writeAudit(req, { action: 'project.create', module: 'projects', entityId: project.id });
    return sendCreated(res, project, 'Project created successfully');
  }),
);

projectsRouter.get(
  '/:id',
  requirePermission('projects.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    await loadAccessibleProject(req, req.params.id);
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        service: { select: { id: true, name: true, category: true } },
        manager: { select: { id: true, firstName: true, lastName: true, email: true } },
        members: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true } } } },
        milestones: { orderBy: { sortOrder: 'asc' } },
        checklist: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { tasks: true, invoices: true, updates: true, revisions: true, attachments: true } },
      },
    });
    return sendSuccess(res, project);
  }),
);

projectsRouter.patch(
  '/:id',
  requirePermission('projects.update'),
  validate(idParamSchema, 'params'),
  validate(projectUpdateBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof projectUpdateBodySchema>;
    const existing = await loadAccessibleProject(req, req.params.id);
    if (!hasPermission(req.user, 'projects.update') ) {
      throw new AppError('You do not have permission to perform this action', 403);
    }
    if (!hasPermission(req.user, 'projects.viewAll') && existing.managerId !== req.user!.id) {
      throw new AppError('Only the project manager can update this project', 403);
    }

    const project = await prisma.project.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.serviceId !== undefined ? { serviceId: data.serviceId } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.managerId !== undefined ? { managerId: data.managerId } : {}),
        ...(data.budget !== undefined ? { budget: data.budget } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.startDate !== undefined ? { startDate: data.startDate ?? null } : {}),
        ...(data.deadline !== undefined ? { deadline: data.deadline ?? null } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.status !== undefined
          ? { status: data.status, completedAt: data.status === 'COMPLETED' ? new Date() : null }
          : {}),
        ...(data.estimatedHours !== undefined ? { estimatedHours: data.estimatedHours } : {}),
        ...(data.progress !== undefined ? { progress: data.progress } : {}),
        ...(data.internalNotes !== undefined ? { internalNotes: data.internalNotes } : {}),
        ...(data.tags !== undefined ? { tags: data.tags as Prisma.InputJsonValue } : {}),
      },
    });
    await writeAudit(req, { action: 'project.update', module: 'projects', entityId: project.id });

    if (data.status === 'COMPLETED') {
      await logActivity({
        actorId: req.user!.id,
        action: 'project.completed',
        entityType: 'Project',
        entityId: project.id,
        projectId: project.id,
        clientId: project.clientId,
        summary: `Project ${project.name} marked complete`,
        isClientVisible: true,
      });
      // Notify, but never auto-mark invoices paid - billing remains a manual finance action.
      await notifyUsers([
        {
          userId: project.managerId ?? req.user!.id,
          type: 'PROJECT_COMPLETED',
          title: 'Project completed',
          message: `${project.name} was marked as completed. Review billing and invoicing.`,
          entityType: 'Project',
          entityId: project.id,
          link: `/projects/${project.id}`,
          dedupeKey: `project-completed:${project.id}`,
        },
      ]);
    }
    return sendSuccess(res, project, { message: 'Project updated successfully' });
  }),
);

projectsRouter.delete(
  '/:id',
  requirePermission('projects.delete'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.project.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!existing) throw new AppError('Project not found', 404);
    await prisma.project.update({ where: { id: existing.id }, data: { deletedAt: new Date(), status: 'CANCELLED' } });
    await writeAudit(req, { action: 'project.archive', module: 'projects', entityId: existing.id });
    return sendNoContent(res);
  }),
);

/* --------------------------------- Members --------------------------------- */

projectsRouter.post(
  '/:id/members',
  requirePermission('projects.assign'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const project = await prisma.project.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!project) throw new AppError('Project not found', 404);
    const userId = String(req.body?.userId ?? '');
    if (!userId) throw new AppError('A user is required', 422);
    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new AppError('User not found', 404);

    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId } },
      update: { role: req.body?.role ? String(req.body.role) : undefined },
      create: { projectId: project.id, userId, role: req.body?.role ? String(req.body.role) : null },
    });
    await createNotification({
      userId,
      type: 'PROJECT_ASSIGNED',
      title: 'Added to a project',
      message: `You were added to ${project.name}`,
      entityType: 'Project',
      entityId: project.id,
      link: `/projects/${project.id}`,
      dedupeKey: `project-assigned:${project.id}:${userId}`,
    });
    return sendCreated(res, member);
  }),
);

projectsRouter.delete(
  '/:id/members/:userId',
  requirePermission('projects.assign'),
  ah(async (req: AuthRequest, res) => {
    const deleted = await prisma.projectMember.deleteMany({
      where: { projectId: req.params.id, userId: req.params.userId },
    });
    if (!deleted.count) throw new AppError('Project member not found', 404);
    return sendNoContent(res);
  }),
);

/* -------------------------------- Milestones ------------------------------- */

projectsRouter.post(
  '/:id/milestones',
  requirePermission('projects.update'),
  validate(idParamSchema, 'params'),
  validate(milestoneSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof milestoneSchema>;
    const project = await prisma.project.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!project) throw new AppError('Project not found', 404);
    const milestone = await prisma.milestone.create({
      data: {
        projectId: project.id,
        title: data.title,
        description: data.description ?? null,
        dueDate: data.dueDate ?? null,
        status: data.status ?? 'PENDING',
        isClientVisible: data.isClientVisible ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });
    return sendCreated(res, milestone);
  }),
);

projectsRouter.patch(
  '/:id/milestones/:milestoneId',
  requirePermission('projects.update'),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof milestoneSchema>;
    const milestone = await prisma.milestone.findFirst({
      where: { id: req.params.milestoneId, projectId: req.params.id },
    });
    if (!milestone) throw new AppError('Milestone not found', 404);
    const updated = await prisma.milestone.update({
      where: { id: milestone.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate ?? null } : {}),
        ...(data.status !== undefined
          ? { status: data.status, completedAt: data.status === 'COMPLETED' ? new Date() : null }
          : {}),
        ...(data.isClientVisible !== undefined ? { isClientVisible: data.isClientVisible } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });
    return sendSuccess(res, updated);
  }),
);

projectsRouter.delete(
  '/:id/milestones/:milestoneId',
  requirePermission('projects.update'),
  ah(async (req: AuthRequest, res) => {
    const deleted = await prisma.milestone.deleteMany({
      where: { id: req.params.milestoneId, projectId: req.params.id },
    });
    if (!deleted.count) throw new AppError('Milestone not found', 404);
    return sendNoContent(res);
  }),
);

/* --------------------------------- Updates --------------------------------- */

projectsRouter.get(
  '/:id/updates',
  requirePermission('projects.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    await loadAccessibleProject(req, req.params.id);
    const updates = await prisma.projectUpdate.findMany({
      where: { projectId: req.params.id },
      include: { author: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return sendSuccess(res, updates);
  }),
);

projectsRouter.post(
  '/:id/updates',
  requirePermission('projects.update'),
  validate(idParamSchema, 'params'),
  validate(updatePostSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof updatePostSchema>;
    const project = await loadAccessibleProject(req, req.params.id);
    const update = await prisma.projectUpdate.create({
      data: {
        projectId: project.id,
        authorId: req.user!.id,
        title: data.title ?? null,
        body: data.body,
        isClientVisible: data.isClientVisible ?? true,
      },
    });
    await logActivity({
      actorId: req.user!.id,
      action: 'project.update_posted',
      entityType: 'Project',
      entityId: project.id,
      projectId: project.id,
      clientId: project.clientId,
      summary: data.title ?? 'Project update posted',
      isClientVisible: data.isClientVisible ?? true,
    });
    return sendCreated(res, update);
  }),
);

/* -------------------------------- Revisions -------------------------------- */

projectsRouter.get(
  '/:id/revisions',
  requirePermission('projects.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    await loadAccessibleProject(req, req.params.id);
    const revisions = await prisma.revisionRequest.findMany({
      where: { projectId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    return sendSuccess(res, revisions);
  }),
);

projectsRouter.post(
  '/:id/revisions',
  requirePermission('projects.update'),
  validate(idParamSchema, 'params'),
  validate(revisionSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof revisionSchema>;
    const project = await loadAccessibleProject(req, req.params.id);
    const revision = await prisma.revisionRequest.create({
      data: {
        projectId: project.id,
        requestedById: req.user!.id,
        title: data.title,
        description: data.description,
        status: 'OPEN',
      },
    });
    await notifyUsers([
      {
        userId: project.managerId ?? req.user!.id,
        type: 'REVISION_REQUESTED',
        title: 'Revision requested',
        message: `${data.title} on ${project.name}`,
        entityType: 'Project',
        entityId: project.id,
        link: `/projects/${project.id}`,
        dedupeKey: `revision:${revision.id}`,
      },
    ]);
    return sendCreated(res, revision);
  }),
);

projectsRouter.patch(
  '/:id/revisions/:revisionId',
  requirePermission('projects.update'),
  ah(async (req: AuthRequest, res) => {
    const data = revisionUpdateSchema.parse(req.body);
    const revision = await prisma.revisionRequest.findFirst({
      where: { id: req.params.revisionId, projectId: req.params.id },
    });
    if (!revision) throw new AppError('Revision request not found', 404);
    const updated = await prisma.revisionRequest.update({
      where: { id: revision.id },
      data: {
        ...(data.status !== undefined
          ? { status: data.status, resolvedAt: ['RESOLVED', 'REJECTED'].includes(data.status) ? new Date() : null }
          : {}),
        ...(data.response !== undefined ? { response: data.response } : {}),
      },
    });
    return sendSuccess(res, updated);
  }),
);

/* -------------------------------- Checklist -------------------------------- */

projectsRouter.post(
  '/:id/checklist',
  requirePermission('projects.update'),
  validate(idParamSchema, 'params'),
  validate(checklistSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof checklistSchema>;
    const project = await prisma.project.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!project) throw new AppError('Project not found', 404);
    const item = await prisma.checklistItem.create({
      data: { projectId: project.id, title: data.title, isDone: data.isDone ?? false, sortOrder: data.sortOrder ?? 0 },
    });
    return sendCreated(res, item);
  }),
);

projectsRouter.patch(
  '/:id/checklist/:itemId',
  requirePermission('projects.update'),
  ah(async (req: AuthRequest, res) => {
    const item = await prisma.checklistItem.findFirst({ where: { id: req.params.itemId, projectId: req.params.id } });
    if (!item) throw new AppError('Checklist item not found', 404);
    const updated = await prisma.checklistItem.update({
      where: { id: item.id },
      data: {
        ...(req.body?.title !== undefined ? { title: String(req.body.title) } : {}),
        ...(req.body?.isDone !== undefined ? { isDone: Boolean(req.body.isDone) } : {}),
        ...(req.body?.sortOrder !== undefined ? { sortOrder: Number(req.body.sortOrder) } : {}),
      },
    });
    return sendSuccess(res, updated);
  }),
);

projectsRouter.delete(
  '/:id/checklist/:itemId',
  requirePermission('projects.update'),
  ah(async (req: AuthRequest, res) => {
    const deleted = await prisma.checklistItem.deleteMany({ where: { id: req.params.itemId, projectId: req.params.id } });
    if (!deleted.count) throw new AppError('Checklist item not found', 404);
    return sendNoContent(res);
  }),
);

/* ------------------------------- Financials -------------------------------- */

projectsRouter.get(
  '/:id/financials',
  requirePermission('finance.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const project = await prisma.project.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!project) throw new AppError('Project not found', 404);
    const financials = await computeProjectFinancials(project.id, project.currency);
    return sendSuccess(res, { project: { id: project.id, projectNo: project.projectNo, name: project.name, currency: project.currency }, ...financials });
  }),
);
