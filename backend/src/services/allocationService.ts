import { AllocationModel, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { add, allocateByWeights, dec, percentOf, round, sub, ZERO } from '../utils/money';
import { computeProjectFinancials } from './financeService';

export interface AllocationPreviewLine {
  userId: string;
  userName: string;
  percent: Prisma.Decimal | null;
  fixedAmount: Prisma.Decimal | null;
  amount: Prisma.Decimal;
  isRoundingAdjustment: boolean;
  role?: string | null;
}

export interface AllocationPreview {
  projectId: string;
  projectName: string;
  ruleId: string;
  ruleName: string;
  ruleVersion: number;
  model: AllocationModel;
  currency: string;
  invoicedRevenue: Prisma.Decimal;
  expenses: Prisma.Decimal;
  distributableAmount: Prisma.Decimal;
  lines: AllocationPreviewLine[];
  allocatedTotal: Prisma.Decimal;
  unallocated: Prisma.Decimal;
  reconciled: boolean;
  warnings: string[];
}

/**
 * Builds a preview of proposed allocations WITHOUT writing anything.
 *
 * Distribution basis per configured model:
 *   PERCENT_OF_PROFIT  -> distributable = invoicedRevenue - expenses (never < 0)
 *   PERCENT_OF_REVENUE -> distributable = invoicedRevenue
 *   FIXED              -> distributable = sum of fixed amounts (informational)
 *
 * Percentage lines are reconciled with a largest-remainder algorithm so the
 * sum of entitlements always equals the distributable amount exactly - the
 * unavoidable rounding remainder is assigned to the largest share and flagged.
 */
export async function previewAllocation(projectId: string, ruleId?: string): Promise<AllocationPreview> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: { select: { companyName: true, firstName: true, lastName: true } },
      allocationRules: {
        where: { isActive: true },
        include: { items: true },
        orderBy: { version: 'desc' },
      },
    },
  });
  if (!project) throw new AppError('Project not found', 404);

  const rule = ruleId
    ? await prisma.allocationRule.findFirst({ where: { id: ruleId, projectId }, include: { items: true } })
    : project.allocationRules[0];

  if (!rule) throw new AppError('No active allocation rule configured for this project', 422);

  const financials = await computeProjectFinancials(projectId, project.currency);
  const warnings: string[] = [];

  let distributable = ZERO;
  if (rule.model === AllocationModel.PERCENT_OF_PROFIT) {
    distributable = round(financials.profit);
    if (distributable.lessThanOrEqualTo(0)) {
      warnings.push('No distributable profit available - revenue has not exceeded recorded expenses.');
      distributable = ZERO;
    }
  } else if (rule.model === AllocationModel.PERCENT_OF_REVENUE) {
    distributable = round(financials.invoicedRevenue);
  } else {
    distributable = round(
      rule.items.reduce<Prisma.Decimal>((acc, item) => add(acc, dec(item.fixedAmount)), ZERO),
    );
  }

  if (financials.outstanding.greaterThan(0)) {
    warnings.push(
      `Outstanding receivable of ${financials.currency} ${financials.outstanding.toFixed(2)} - distribution is based on invoiced revenue, not cash received.`,
    );
  }

  const userIds = rule.items.map((item) => item.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameById = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`]));

  const lines: AllocationPreviewLine[] = [];
  const percentItems = rule.items.filter((item) => item.percent !== null && item.percent !== undefined);
  const fixedItems = rule.items.filter((item) => item.percent === null || item.percent === undefined);

  if (percentItems.length) {
    const weights = percentItems.map((item) => dec(item.percent).toNumber());
    const weightSum = weights.reduce((a, b) => a + b, 0);
    if (Math.abs(weightSum - 100) > 0.01) {
      warnings.push(`Percentage weights sum to ${weightSum.toFixed(2)}% instead of 100%. Totals are normalised proportionally.`);
    }
    const amounts = allocateByWeights(distributable, weights);
    percentItems.forEach((item, index) => {
      const exact = percentOf(distributable, dec(item.percent));
      lines.push({
        userId: item.userId,
        userName: nameById.get(item.userId) ?? 'Unknown member',
        percent: dec(item.percent),
        fixedAmount: null,
        amount: amounts[index],
        isRoundingAdjustment: !amounts[index].equals(exact),
        role: item.role,
      });
    });
  }

  for (const item of fixedItems) {
    lines.push({
      userId: item.userId,
      userName: nameById.get(item.userId) ?? 'Unknown member',
      percent: null,
      fixedAmount: dec(item.fixedAmount),
      amount: round(dec(item.fixedAmount)),
      isRoundingAdjustment: false,
      role: item.role,
    });
  }

  const allocatedTotal = round(lines.reduce<Prisma.Decimal>((acc, line) => add(acc, line.amount), ZERO));
  const unallocated = round(sub(distributable, allocatedTotal));

  if (!unallocated.isZero() && rule.model !== AllocationModel.FIXED) {
    warnings.push(`Unallocated remainder: ${distributable.minus(allocatedTotal).toFixed(2)} ${project.currency}.`);
  }

  return {
    projectId,
    projectName: project.name,
    ruleId: rule.id,
    ruleName: rule.name,
    ruleVersion: rule.version,
    model: rule.model,
    currency: project.currency,
    invoicedRevenue: financials.invoicedRevenue,
    expenses: financials.expenses,
    distributableAmount: distributable,
    lines,
    allocatedTotal,
    unallocated,
    reconciled: unallocated.isZero(),
    warnings,
  };
}

/**
 * Commits a previewed allocation into MemberEarning records.
 * Idempotent per (project, rule, version, user) - re-running replaces the
 * PENDING earnings for that rule version only, never already-approved or paid
 * records. Historical payouts are never silently recalculated: changing a rule
 * creates a new version instead.
 */
export async function commitAllocation(projectId: string, ruleId: string, _approvedById: string) {
  const preview = await previewAllocation(projectId, ruleId);

  return prisma.$transaction(async (tx) => {
    const existingPaid = await tx.memberEarning.count({
      where: { projectId, ruleId, status: { in: ['APPROVED', 'PAID'] } },
    });
    if (existingPaid > 0) {
      throw new AppError('This allocation version already has approved or paid earnings and cannot be regenerated.', 409);
    }

    await tx.memberEarning.deleteMany({ where: { projectId, ruleId, status: 'PENDING' } });

    const created = [];
    for (const line of preview.lines) {
      created.push(
        await tx.memberEarning.create({
          data: {
            userId: line.userId,
            projectId,
            ruleId,
            ruleVersion: preview.ruleVersion,
            model: preview.model,
            basisAmount: preview.distributableAmount,
            percent: line.percent ?? undefined,
            amount: line.amount,
            currency: preview.currency,
            status: 'PENDING',
            isRoundingAdjustment: line.isRoundingAdjustment,
          },
        }),
      );
    }
    return { preview, earnings: created };
  });
}
