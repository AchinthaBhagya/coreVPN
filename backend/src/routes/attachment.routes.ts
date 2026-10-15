import { Router } from 'express';
import fs from 'fs';
import { AttachmentCategory, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendCreated, sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { logActivity } from '../services/activityService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasAnyPermission, requirePermission } from '../middleware/authorize';
import { upload, resolveStoredFile, storageKeyFromAbsolute } from '../middleware/upload';
import { validate } from '../middleware/validate';
import { parseListQuery, safeSortField } from '../utils/pagination';
import { ah, idParamSchema, requireClientId, sendList } from './helpers';

export const attachmentsRouter = Router();

attachmentsRouter.use(authenticate);

const SORTABLE = ['createdAt', 'originalName', 'size'];

interface UploadedFileLike {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

interface AttachmentRow {
  id: string;
  clientId: string | null;
  projectId: string | null;
  taskId: string | null;
  invoiceId: string | null;
  paymentId: string | null;
  ticketId: string | null;
  isClientVisible: boolean;
}

/**
 * Resolves the owning client of an attachment through whichever record it is
 * linked to. Used to decide whether a portal account may read/download it.
 */
async function resolveOwningClientIds(attachment: AttachmentRow): Promise<string[]> {
  const ids = new Set<string>();
  if (attachment.clientId) ids.add(attachment.clientId);

  const lookups: Promise<{ clientId: string | null } | null>[] = [];
  if (attachment.projectId) {
    lookups.push(
      prisma.project.findUnique({ where: { id: attachment.projectId }, select: { clientId: true } }),
    );
  }
  if (attachment.taskId) {
    lookups.push(
      prisma.task
        .findUnique({ where: { id: attachment.taskId }, select: { project: { select: { clientId: true } } } })
        .then((row) => (row?.project ? { clientId: row.project.clientId } : null)),
    );
  }
  if (attachment.invoiceId) {
    lookups.push(
      prisma.invoice.findUnique({ where: { id: attachment.invoiceId }, select: { clientId: true } }),
    );
  }
  if (attachment.paymentId) {
    lookups.push(
      prisma.payment.findUnique({ where: { id: attachment.paymentId }, select: { clientId: true } }),
    );
  }
  if (attachment.ticketId) {
    lookups.push(
      prisma.ticket.findUnique({ where: { id: attachment.ticketId }, select: { clientId: true } }),
    );
  }

  for (const row of await Promise.all(lookups)) {
    if (row?.clientId) ids.add(row.clientId);
  }
  return Array.from(ids);
}

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function parseBool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true' || String(value) === '1';
}

/** Streams a stored file with hardened headers (never guessed, never sniffed). */
function streamFile(
  res: Parameters<typeof sendSuccess>[0],
  absPath: string,
  attachment: { mimeType: string; size: number; originalName: string },
  inline: boolean,
) {
  const safeName = attachment.originalName.replace(/[\r\n"]/g, '_');
  res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', String(attachment.size));
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(safeName)}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  const stream = fs.createReadStream(absPath);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).end();
    else res.end();
  });
  stream.pipe(res);
}

/** Uploads a file and links it to the relevant record. Clients may only attach to their own data. */
attachmentsRouter.post(
  '/',
  upload.single('file'),
  ah(async (req: AuthRequest, res) => {
    const file = (req as AuthRequest & { file?: UploadedFileLike }).file;
    if (!file) throw new AppError('A file is required', 422);

    if (!req.user!.isClient) {
      if (!hasAnyPermission(req.user, ['attachments.upload'])) {
        await fs.promises.unlink(file.path).catch(() => undefined);
        throw new AppError('You do not have permission to upload files', 403);
      }
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const category = (body.category ? String(body.category) : 'OTHER') as AttachmentCategory;
    if (!Object.values(AttachmentCategory).includes(category)) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      throw new AppError('Unsupported attachment category', 422);
    }

    const projectId = toStringOrNull(body.projectId);
    const taskId = toStringOrNull(body.taskId);
    const invoiceId = toStringOrNull(body.invoiceId);
    const paymentId = toStringOrNull(body.paymentId);
    const ticketId = toStringOrNull(body.ticketId);
    const ticketMessageId = toStringOrNull(body.ticketMessageId);

    if (req.user!.isClient) {
      if (!hasAnyPermission(req.user, ['portal.uploads.create'])) {
        await fs.promises.unlink(file.path).catch(() => undefined);
        throw new AppError('Not available for client accounts', 403);
      }
    }

    // Determine + validate the owning client(s) for the target records.
    let owningClientId = req.user!.isClient ? req.user!.clientId : toStringOrNull(body.clientId);

    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { clientId: true } });
      if (!project) throw new AppError('Project not found', 404);
      if (req.user!.isClient && project.clientId !== req.user!.clientId) throw new AppError('Project not found', 404);
      owningClientId = owningClientId ?? project.clientId;
    }
    if (invoiceId) {
      const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { clientId: true } });
      if (!invoice) throw new AppError('Invoice not found', 404);
      if (req.user!.isClient && invoice.clientId !== req.user!.clientId) throw new AppError('Invoice not found', 404);
      owningClientId = owningClientId ?? invoice.clientId;
    }
    if (paymentId) {
      const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { clientId: true } });
      if (!payment) throw new AppError('Payment not found', 404);
      if (req.user!.isClient && payment.clientId !== req.user!.clientId) throw new AppError('Payment not found', 404);
      owningClientId = owningClientId ?? payment.clientId;
    }
    if (ticketId) {
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { clientId: true } });
      if (!ticket) throw new AppError('Ticket not found', 404);
      if (req.user!.isClient && ticket.clientId !== req.user!.clientId) throw new AppError('Ticket not found', 404);
      owningClientId = owningClientId ?? ticket.clientId;
    }
    if (taskId && !projectId) {
      const task = await prisma.task.findUnique({ where: { id: taskId }, select: { project: { select: { clientId: true } } } });
      if (!task) throw new AppError('Task not found', 404);
      if (req.user!.isClient && task.project?.clientId !== req.user!.clientId) throw new AppError('Task not found', 404);
      owningClientId = owningClientId ?? task.project?.clientId ?? null;
    }

    const isClientVisible = req.user!.isClient ? true : parseBool(body.isClientVisible, false);

    const attachment = await prisma.attachment.create({
      data: {
        storageKey: storageKeyFromAbsolute(file.path),
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        category,
        uploadedById: req.user!.id,
        projectId,
        taskId,
        invoiceId,
        paymentId,
        ticketId,
        ticketMessageId,
        clientId: owningClientId ?? null,
        isClientVisible,
      },
    });

    if (owningClientId) {
      await logActivity({
        actorId: req.user!.id,
        action: 'attachment.uploaded',
        entityType: 'Attachment',
        entityId: attachment.id,
        clientId: owningClientId,
        projectId,
        summary: `File uploaded: ${attachment.originalName}`,
        isClientVisible,
      });
    }
    await writeAudit(req, { action: 'attachment.upload', module: 'attachments', entityId: attachment.id });
    return sendCreated(res, attachment, 'File uploaded');
  }),
);

attachmentsRouter.get(
  '/',
  ah(async (req: AuthRequest, res) => {
    const query = parseListQuery(req);
    const where: Prisma.AttachmentWhereInput = { deletedAt: null };

    if (req.user!.isClient) {
      // Clients only ever see files explicitly shared with them.
      const clientId = requireClientId(req);
      where.isClientVisible = true;
      where.OR = [
        { clientId },
        { project: { clientId } },
        { ticket: { clientId } },
        { invoice: { clientId } },
        { payment: { clientId } },
      ];
    } else {
      if (!hasAnyPermission(req.user, ['attachments.view'])) {
        throw new AppError('You do not have permission to view files', 403);
      }
      if (req.query.projectId) where.projectId = String(req.query.projectId);
      if (req.query.taskId) where.taskId = String(req.query.taskId);
      if (req.query.clientId) where.clientId = String(req.query.clientId);
      if (req.query.invoiceId) where.invoiceId = String(req.query.invoiceId);
      if (req.query.ticketId) where.ticketId = String(req.query.ticketId);
      if (req.query.category) where.category = String(req.query.category) as AttachmentCategory;
    }

    const [items, total] = await Promise.all([
      prisma.attachment.findMany({
        where,
        orderBy: { [safeSortField(query.sortBy, [...SORTABLE], 'createdAt')]: query.sortDir },
        skip: query.skip,
        take: query.take,
      }),
      prisma.attachment.count({ where }),
    ]);
    return sendList(res, items, total, query.page, query.limit);
  }),
);

attachmentsRouter.get(
  '/:id',
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const attachment = await prisma.attachment.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!attachment) throw new AppError('File not found', 404);

    if (req.user!.isClient) {
      if (!attachment.isClientVisible) throw new AppError('File not found', 404);
      const owningClients = await resolveOwningClientIds(attachment);
      if (!req.user!.clientId || !owningClients.includes(req.user!.clientId)) {
        throw new AppError('File not found', 404);
      }
    } else if (!hasAnyPermission(req.user, ['attachments.view'])) {
      throw new AppError('You do not have permission to view files', 403);
    }

    if (req.query.download !== 'true' && req.query.inline !== 'true') {
      return sendSuccess(res, attachment);
    }

    const inlineRequested = req.query.inline === 'true';
    const inlineAllowed = inlineRequested && /^(image\/|application\/pdf)/.test(attachment.mimeType);

    const absolute = resolveStoredFile(attachment.storageKey);
    if (!fs.existsSync(absolute)) throw new AppError('File is no longer available', 410);
    return streamFile(res, absolute, attachment, inlineAllowed);
  }),
);

attachmentsRouter.delete(
  '/:id',
  requirePermission('attachments.delete'),
  validate(idParamSchema, 'params'),
  ah(async (req: AuthRequest, res) => {
    const attachment = await prisma.attachment.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!attachment) throw new AppError('File not found', 404);

    await prisma.attachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date() } });
    // The binary is retained for audit retention; only the record is hidden.
    await writeAudit(req, { action: 'attachment.delete', module: 'attachments', entityId: attachment.id });
    return sendNoContent(res);
  }),
);
