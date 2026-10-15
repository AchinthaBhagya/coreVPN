import { Router } from 'express';
import { z } from 'zod';
import { AllocationModel, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { commitAllocation, previewAllocation } from '../services/allocationService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { ah, idParamSchema } from './helpers';

export const allocationsRouter = Router();

allocationsRouter.use(authenticate, denyClients());

const ruleItemSchema = z
  .object({
    userId: z.string().min(1),
    percent: z.union([z.number(), z.string()]).nullable().optional(),
    fixedAmount: z.union([z.number(), z.string()]).nullable().optional(),
    role: z.string().trim().max(80).nullable().optional(),
  })
  .refine((item) => item.percent !== undefined && item.percent !== null || (item.fixedAmount !== undefined && item.fixedAmount !== null), {
    message: 'Each allocation line needs a percentage or a fixed amount',
  });

const ruleBodySchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().trim().min(2).max(120),
    model: z.nativeEnum(AllocationModel),
    notes: z.string().max(2000).nullable().optional(),
    items: z.array(ruleItemSchema).min(1, 'At least one allocation line is required'),
  })
  .superRefine((body, ctx) => {
    // Percentage models must distribute exactly 100%. Anything else would be
    // silently renormalised at commit time, which hides a mis-specified split
    // from the people approving it - so it is rejected up front instead.
    if (body.model === AllocationModel.FIXED) return;

    let total = 0;
    let complete = true;
    for (const item of body.items) {
      if (item.percent === undefined || item.percent === null) {
        complete = false;
        continue;
      }
      total += Number(item.percent);
    }
    if (!complete || Math.abs(total - 100) > 0.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: `Percentage allocations must add up to exactly 100% (currently ${complete ? total.toFixed(2).replace(/\.00$/, '') : 'an incomplete'}%)`,
      });
    }
  });

/** Lists allocation rules for a project (history preserved by version). */
allocationsRouter.get(
  '/rules',
  requirePermission('allocations.view'),
  ah(async (req: AuthRequest, res) => {
    const projectId = String(req.query.projectId ?? '');
    if (!projectId) throw new AppError('projectId is required', 422);
    const rules = await prisma.allocationRule.findMany({
      where: { projectId },
      include: {
        items: true,
        createdBy: { select: { firstName: true, lastName: true } },
        _count: { select: { earnings: true } },
      },
      orderBy: { version: 'desc' },
    });
    return sendSuccess(res, rules);
  }),
);

/**
 * Creates a new immutable version of an allocation rule. Existing versions are
 * never mutated once earnings reference them, so historical distributions stay
 * auditable.
 */
allocationsRouter.post(
  '/rules',
  requirePermission('allocations.manage'),
  validate(ruleBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof ruleBodySchema>;
    const project = await prisma.project.findFirst({ where: { id: data.projectId, deletedAt: null } });
    if (!project) throw new AppError('Project not found', 404);

    const memberIds = await prisma.projectMember.findMany({
      where: { projectId: project.id },
      select: { userId: true },
    });
    const memberSet = new Set(memberIds.map((m) => m.userId));
    const invalid = data.items.filter((item) => !memberSet.has(item.userId));
    if (invalid.length) {
      throw new AppError('All allocation recipients must be project members', 422);
    }

    const latest = await prisma.allocationRule.findFirst({
      where: { projectId: project.id },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;

    const rule = await prisma.$transaction(async (tx) => {
      await tx.allocationRule.updateMany({ where: { projectId: project.id, isActive: true }, data: { isActive: false } });
      return tx.allocationRule.create({
        data: {
          projectId: project.id,
          name: data.name,
          model: data.model,
          version,
          isActive: true,
          notes: data.notes ?? null,
          createdById: req.user!.id,
          supersededById: null,
          items: {
            create: data.items.map((item) => ({
              userId: item.userId,
              percent: item.percent !== null && item.percent !== undefined ? new Prisma.Decimal(item.percent) : null,
              fixedAmount:
                item.fixedAmount !== null && item.fixedAmount !== undefined ? new Prisma.Decimal(item.fixedAmount) : null,
              role: item.role ?? null,
            })),
          },
        },
        include: { items: true },
      });
    });

    await writeAudit(req, { action: 'allocation.rule.create', module: 'allocations', entityId: rule.id, details: { version, model: rule.model } });
    return sendCreated(res, rule, `Allocation rule v${version} created`);
  }),
);

/** Preview-only: proposes a distribution without writing anything. */
allocationsRouter.get(
  '/projects/:id/preview',
  requirePermission('allocations.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const ruleId = req.query.ruleId ? String(req.query.ruleId) : undefined;
    const preview = await previewAllocation(req.params.id, ruleId);
    return sendSuccess(res, preview);
  }),
);

/** Commits a previewed allocation into PENDING member earnings. */
allocationsRouter.post(
  '/projects/:id/commit',
  requirePermission('allocations.approve'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const ruleId = String(req.body?.ruleId ?? '');
    if (!ruleId) throw new AppError('ruleId is required', 422);
    const rule = await prisma.allocationRule.findFirst({ where: { id: ruleId, projectId: req.params.id } });
    if (!rule) throw new AppError('Allocation rule not found for this project', 404);

    const result = await commitAllocation(req.params.id, ruleId, req.user!.id);
    await writeAudit(req, {
      action: 'allocation.commit',
      module: 'allocations',
      entityId: ruleId,
      details: { projectId: req.params.id, lines: result.earnings.length },
    });
    return sendCreated(res, result, 'Allocation committed as pending member earnings');
  }),
);
