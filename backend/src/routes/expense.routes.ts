import { Router } from 'express';
import { z } from 'zod';
import { ExpenseFrequency, ExpenseStatus, PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { numbering } from '../services/numberingService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission, denyClients } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, moneySchema, optionalMoneySchema, sendList } from './helpers';

export const expensesRouter = Router();
export const expenseCategoriesRouter = Router();

expensesRouter.use(authenticate, denyClients());
expenseCategoriesRouter.use(authenticate, denyClients());

const SORTABLE = ['createdAt', 'expenseDate', 'amount', 'status'];

const expenseBodySchema = z.object({
  categoryId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  vendor: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().min(1).max(5000),
  amount: moneySchema,
  taxAmount: optionalMoneySchema,
  currency: z.string().length(3).toUpperCase().optional(),
  expenseDate: z.union([z.string(), z.date()]).optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  status: z.nativeEnum(ExpenseStatus).optional(),
  isRecurring: z.boolean().optional(),
  frequency: z.nativeEnum(ExpenseFrequency).optional(),
  nextDueDate: z.union([z.string(), z.date()]).nullable().optional(),
  isClientBillable: z.boolean().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const expenseUpdateSchema = expenseBodySchema.partial();

const rejectSchema = z.object({ note: z.string().max(1000).nullable().optional() });

expensesRouter.get(
  '/',
  requirePermission('expenses.view'),
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const sortBy = safeSortField(query.sortBy, SORTABLE, 'expenseDate');
    const where: Prisma.ExpenseWhereInput = {
      ...(query.search ? { OR: [{ description: { contains: query.search } }, { vendor: { contains: query.search } }, { expenseNo: { contains: query.search } }] } : {}),
      ...(req.query.status ? { status: String(req.query.status) as ExpenseStatus } : {}),
      ...(req.query.categoryId ? { categoryId: String(req.query.categoryId) } : {}),
      ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}),
      ...(query.dateFrom || query.dateTo
        ? { expenseDate: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lte: query.dateTo } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          project: { select: { id: true, name: true, projectNo: true } },
          createdBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { [sortBy]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.expense.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

expensesRouter.post(
  '/',
  requirePermission('expenses.create'),
  validate(expenseBodySchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof expenseBodySchema>;
    const category = await prisma.expenseCategory.findUnique({ where: { id: data.categoryId } });
    if (!category) throw new AppError('Expense category not found', 404);

    const expense = await prisma.$transaction(async (tx) => {
      const expenseNo = await numbering.expenseNumber(tx);
      return tx.expense.create({
        data: {
          expenseNo,
          categoryId: category.id,
          projectId: data.projectId ?? null,
          vendor: data.vendor ?? null,
          description: data.description,
          amount: data.amount,
          taxAmount: data.taxAmount ?? '0',
          currency: data.currency ?? 'LKR',
          expenseDate: data.expenseDate ? new Date(data.expenseDate) : new Date(),
          method: data.method ?? 'BANK_TRANSFER',
          status: data.status ?? 'PENDING',
          isRecurring: data.isRecurring ?? false,
          frequency: data.frequency ?? 'NONE',
          nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
          isClientBillable: data.isClientBillable ?? false,
          notes: data.notes ?? null,
          createdById: req.user!.id,
        },
        include: { category: true },
      });
    });
    await writeAudit(req, { action: 'expense.create', module: 'expenses', entityId: expense.id });
    return sendCreated(res, expense, 'Expense recorded');
  }),
);

expensesRouter.get(
  '/:id',
  requirePermission('expenses.view'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: { category: true, project: { select: { id: true, name: true } }, createdBy: { select: { firstName: true, lastName: true } } },
    });
    if (!expense) throw new AppError('Expense not found', 404);
    return sendSuccess(res, expense);
  }),
);

expensesRouter.patch(
  '/:id',
  requirePermission('expenses.update'),
  validate(idParamSchema, 'params'),
  validate(expenseUpdateSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof expenseUpdateSchema>;
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Expense not found', 404);
    if (['PAID'].includes(existing.status) && !req.user!.permissions.includes('expenses.approve')) {
      throw new AppError('Paid expenses can only be changed by an approver', 403);
    }

    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: {
        ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
        ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
        ...(data.vendor !== undefined ? { vendor: data.vendor } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
        ...(data.taxAmount !== undefined ? { taxAmount: data.taxAmount } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.expenseDate !== undefined ? { expenseDate: new Date(data.expenseDate) } : {}),
        ...(data.method !== undefined ? { method: data.method } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.isRecurring !== undefined ? { isRecurring: data.isRecurring } : {}),
        ...(data.frequency !== undefined ? { frequency: data.frequency } : {}),
        ...(data.nextDueDate !== undefined ? { nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : null } : {}),
        ...(data.isClientBillable !== undefined ? { isClientBillable: data.isClientBillable } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });
    return sendSuccess(res, expense, { message: 'Expense updated' });
  }),
);

async function setStatus(
  req: AuthRequest,
  status: ExpenseStatus,
  extra: Prisma.ExpenseUncheckedUpdateInput = {},
) {
  const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Expense not found', 404);
  return prisma.expense.update({ where: { id: existing.id }, data: { status, ...extra } });
}

expensesRouter.post(
  '/:id/approve',
  requirePermission('expenses.approve'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const expense = await setStatus(req, 'APPROVED', {
      approvedById: req.user!.id,
      approvedAt: new Date(),
      rejectionNote: null,
    });
    await writeAudit(req, { action: 'expense.approve', module: 'expenses', entityId: expense.id });
    return sendSuccess(res, expense, { message: 'Expense approved' });
  }),
);

expensesRouter.post(
  '/:id/reject',
  requirePermission('expenses.approve'),
  validate(idParamSchema, 'params'),
  validate(rejectSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof rejectSchema>;
    const expense = await setStatus(req, 'REJECTED', {
      approvedById: req.user!.id,
      approvedAt: new Date(),
      rejectionNote: data.note ?? null,
    });
    return sendSuccess(res, expense, { message: 'Expense rejected' });
  }),
);

expensesRouter.post(
  '/:id/pay',
  requirePermission('expenses.approve'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const expense = await setStatus(req, 'PAID', { paidAt: new Date() });
    await writeAudit(req, { action: 'expense.pay', module: 'expenses', entityId: expense.id });
    return sendSuccess(res, expense, { message: 'Expense marked paid' });
  }),
);

expensesRouter.delete(
  '/:id',
  requirePermission('expenses.delete'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Expense not found', 404);
    if (existing.status === 'PAID') throw new AppError('Paid expenses cannot be deleted', 409);
    await prisma.expense.delete({ where: { id: existing.id } });
    await writeAudit(req, { action: 'expense.delete', module: 'expenses', entityId: existing.id });
    return sendNoContent(res);
  }),
);

/* ------------------------------ Categories -------------------------------- */

expenseCategoriesRouter.get(
  '/',
  requirePermission('expenses.view'),
  ah(async (_req: AuthRequest, res) => {
    const categories = await prisma.expenseCategory.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { expenses: true } } },
    });
    return sendSuccess(res, categories);
  }),
);

expenseCategoriesRouter.post(
  '/',
  requirePermission('expenses.update'),
  validate(
    z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).nullable().optional() }),
  ),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as { name: string; description?: string | null };
    const category = await prisma.expenseCategory.create({ data: { name: data.name, description: data.description ?? null } });
    return sendCreated(res, category);
  }),
);

expenseCategoriesRouter.patch(
  '/:id',
  requirePermission('expenses.update'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const existing = await prisma.expenseCategory.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Category not found', 404);
    const category = await prisma.expenseCategory.update({
      where: { id: existing.id },
      data: {
        ...(req.body?.name !== undefined ? { name: String(req.body.name) } : {}),
        ...(req.body?.description !== undefined ? { description: req.body.description ? String(req.body.description) : null } : {}),
        ...(req.body?.isActive !== undefined ? { isActive: Boolean(req.body.isActive) } : {}),
      },
    });
    return sendSuccess(res, category);
  }),
);

expenseCategoriesRouter.delete(
  '/:id',
  requirePermission('expenses.update'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const category = await prisma.expenseCategory.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { expenses: true } } },
    });
    if (!category) throw new AppError('Category not found', 404);
    if (category._count.expenses > 0) throw new AppError('Move or delete expenses before removing this category', 409);
    await prisma.expenseCategory.delete({ where: { id: category.id } });
    return sendNoContent(res);
  }),
);
