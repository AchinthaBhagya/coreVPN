import { ExpenseFrequency, JobType, NotificationType } from '@prisma/client';
import { prisma } from '../config/prisma';
import logger from '../config/logger';
import { numbering } from '../services/numberingService';
import { createNotification, notifyPermissionHolders } from '../services/notificationService';
import { discordService } from '../services/discordService';

/**
 * Lightweight in-process scheduler. Each job:
 *  - is idempotent for a given window via a `dedupeKey` on BackgroundJob,
 *  - records its outcome (SUCCESS/FAILED, attempts, lastError) for visibility,
 *  - never performs financial state transitions that belong to a human action
 *    (e.g. it flags an invoice overdue but never marks it paid).
 *
 * This is intentionally dependency-free so it runs on a single Linode box under
 * PM2 without Redis or an external queue.
 */

const timers: NodeJS.Timeout[] = [];
let running = false;

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function withJob(
  type: JobType,
  dedupeKey: string,
  handler: () => Promise<string | void>,
): Promise<void> {
  const existing = await prisma.backgroundJob.findUnique({ where: { dedupeKey } }).catch(() => null);
  if (existing && existing.status !== 'FAILED') return;

  const job = existing
    ? await prisma.backgroundJob.update({
        where: { id: existing.id },
        data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
      })
    : await prisma.backgroundJob.create({
        data: { type, dedupeKey, status: 'RUNNING', startedAt: new Date(), attempts: 1 },
      });

  try {
    const result = await handler();
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: 'SUCCESS', finishedAt: new Date(), lastError: null, payload: result ? { result } : undefined },
    });
  } catch (error) {
    logger.error(`Background job ${type} failed`, { error });
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: job.attempts >= job.maxAttempts ? 'FAILED' : 'PENDING',
        finishedAt: new Date(),
        lastError: (error as Error).message?.slice(0, 500) ?? 'Unknown error',
      },
    }).catch(() => undefined);
  }
}

/* ---------------------------- INVOICE_OVERDUE_SCAN -------------------------- */

async function invoiceOverdueScan(): Promise<string> {
  const now = new Date();
  const overdue = await prisma.invoice.findMany({
    where: { status: { notIn: ['PAID', 'VOID', 'DRAFT', 'OVERDUE'] }, dueDate: { lt: now } },
    select: { id: true, invoiceNo: true, balance: true, currency: true, dueDate: true, clientId: true, projectId: true },
  });

  for (const invoice of overdue) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'OVERDUE' } });
    await notifyPermissionHolders('invoices.view', {
      type: NotificationType.INVOICE_OVERDUE,
      title: 'Invoice overdue',
      message: `${invoice.invoiceNo} is overdue with a balance of ${invoice.currency} ${invoice.balance.toFixed(2)}`,
      entityType: 'Invoice',
      entityId: invoice.id,
      link: `/invoices/${invoice.id}`,
      dedupeKey: `invoice-overdue:${invoice.id}:${dayKey()}`,
    });
  }
  return `flagged ${overdue.length} overdue invoice(s)`;
}

/* ----------------------------- DEADLINE_REMINDERS --------------------------- */

async function deadlineReminders(): Promise<string> {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const [projects, tasks] = await Promise.all([
    prisma.project.findMany({
      where: { deletedAt: null, deadline: { gte: now, lte: soon }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      select: { id: true, name: true, deadline: true, managerId: true },
    }),
    prisma.task.findMany({
      where: { deletedAt: null, dueDate: { gte: now, lte: soon }, status: { notIn: ['DONE', 'CANCELLED'] }, assigneeId: { not: null } },
      select: { id: true, title: true, dueDate: true, assigneeId: true, projectId: true },
    }),
  ]);

  for (const project of projects) {
    if (!project.managerId) continue;
    await createNotification({
      userId: project.managerId,
      type: NotificationType.DEADLINE_UPCOMING,
      title: 'Project deadline approaching',
      message: `${project.name} is due on ${project.deadline?.toISOString().slice(0, 10)}`,
      entityType: 'Project',
      entityId: project.id,
      link: `/projects/${project.id}`,
      dedupeKey: `project-deadline:${project.id}:${dayKey()}`,
    });
  }

  for (const task of tasks) {
    if (!task.assigneeId) continue;
    await createNotification({
      userId: task.assigneeId,
      type: NotificationType.DEADLINE_UPCOMING,
      title: 'Task due soon',
      message: `${task.title} is due on ${task.dueDate?.toISOString().slice(0, 10)}`,
      entityType: 'Task',
      entityId: task.id,
      link: `/tasks/${task.id}`,
      dedupeKey: `task-deadline:${task.id}:${dayKey()}`,
    });
  }

  return `notified ${projects.length} project(s) and ${tasks.length} task(s)`;
}

/* ----------------------------- RECURRING_EXPENSES --------------------------- */

function advance(date: Date, frequency: ExpenseFrequency): Date | null {
  const next = new Date(date);
  switch (frequency) {
    case ExpenseFrequency.WEEKLY: next.setDate(next.getDate() + 7); return next;
    case ExpenseFrequency.MONTHLY: next.setMonth(next.getMonth() + 1); return next;
    case ExpenseFrequency.QUARTERLY: next.setMonth(next.getMonth() + 3); return next;
    case ExpenseFrequency.YEARLY: next.setFullYear(next.getFullYear() + 1); return next;
    default: return null;
  }
}

async function recurringExpenses(): Promise<string> {
  const now = new Date();
  const due = await prisma.expense.findMany({
    where: { isRecurring: true, frequency: { not: ExpenseFrequency.NONE }, nextDueDate: { lte: now } },
  });

  let created = 0;
  for (const expense of due) {
    const nextDate = expense.nextDueDate ? advance(expense.nextDueDate, expense.frequency) : null;
    await prisma.$transaction(async (tx) => {
      const expenseNo = await numbering.expenseNumber(tx);
      await tx.expense.create({
        data: {
          expenseNo,
          categoryId: expense.categoryId,
          projectId: expense.projectId,
          vendor: expense.vendor,
          description: `${expense.description} (recurring)`,
          amount: expense.amount,
          taxAmount: expense.taxAmount,
          currency: expense.currency,
          expenseDate: expense.nextDueDate ?? now,
          method: expense.method,
          status: 'PENDING',
          isRecurring: true,
          frequency: expense.frequency,
          nextDueDate: nextDate,
          isClientBillable: expense.isClientBillable,
          notes: expense.notes,
          createdById: expense.createdById,
        },
      });
      // Advance the template's next due date so the same period is not recreated.
      await tx.expense.update({ where: { id: expense.id }, data: { nextDueDate: nextDate } });
    });
    created += 1;
  }
  return `generated ${created} recurring expense(s)`;
}

/* ------------------------------ SESSION_CLEANUP ----------------------------- */

async function sessionCleanup(): Promise<string> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  // Opportunistically prune consumed/expired password reset tokens and finished jobs.
  await prisma.passwordResetToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
  });
  return `removed ${result.count} expired session(s)`;
}

/* ------------------------------- DISCORD_RETRY ------------------------------ */

async function discordRetry(): Promise<string> {
  // Re-attempt webhook deliveries that previously failed. Payload templates are
  // stored on the integration setting; delivery itself already retries inline,
  // so here we only reconcile counters and surface persistent failures.
  const failing = await prisma.integrationSetting.findMany({
    where: { provider: 'DISCORD', failureCount: { gt: 0 } },
    select: { key: true, failureCount: true, lastError: true },
  });
  for (const row of failing) {
    const event = row.key.startsWith('webhook.') ? row.key.slice('webhook.'.length) : row.key;
    await discordService.dispatch(event, {
      content: `Retrying Discord delivery for \`${event}\` (previous failures: ${row.failureCount}).`,
    });
  }
  return `retried ${failing.length} Discord event(s)`;
}

/* ------------------------------ HOUSEKEEPING -------------------------------- */

async function housekeeping(): Promise<string> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.backgroundJob.deleteMany({
    where: { status: { in: ['SUCCESS', 'CANCELLED'] }, createdAt: { lt: cutoff } },
  });
  return `pruned ${result.count} old job record(s)`;
}

/* -------------------------------- Runner ------------------------------------ */

async function runAll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const key = dayKey();
    await withJob(JobType.INVOICE_OVERDUE_SCAN, `job:overdue-scan:${key}`, invoiceOverdueScan);
    await withJob(JobType.DEADLINE_REMINDERS, `job:deadline-reminders:${key}`, deadlineReminders);
    await withJob(JobType.RECURRING_EXPENSES, `job:recurring-expenses:${key}`, recurringExpenses);
    await withJob(JobType.SESSION_CLEANUP, `job:session-cleanup:${key}`, sessionCleanup);
    await withJob(JobType.DISCORD_RETRY, `job:discord-retry:${key}`, discordRetry);
    await withJob(JobType.FILE_CLEANUP, `job:housekeeping:${key}`, housekeeping);
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  // Delay the first run slightly so the server has fully booted.
  const initial = setTimeout(() => void runAll(), 15_000);
  initial.unref();
  timers.push(initial);

  const interval = setInterval(() => void runAll(), 60 * 60 * 1000); // hourly
  interval.unref();
  timers.push(interval);

  logger.info('Background scheduler started');
}

export function stopScheduler(): void {
  for (const timer of timers.splice(0, timers.length)) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  logger.info('Background scheduler stopped');
}

/** Exposed for tests and manual/admin triggering. */
export const schedulerJobs = {
  runAll,
  invoiceOverdueScan,
  deadlineReminders,
  recurringExpenses,
  sessionCleanup,
  discordRetry,
};
