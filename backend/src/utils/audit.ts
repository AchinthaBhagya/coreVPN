import { Request } from 'express';
import { prisma } from '../config/prisma';
import logger from '../config/logger';

export interface AuditInput {
  action: string;
  module: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}

/**
 * Writes an immutable audit record for sensitive actions
 * (role changes, payment recording, approvals, payouts, deletions...).
 * Failures to write an audit record are logged but never break the request.
 */
export async function writeAudit(req: Request, input: AuditInput): Promise<void> {
  try {
    const user = (req as Request & { user?: { id: string } }).user;
    await prisma.auditLog.create({
      data: {
        userId: user?.id ?? null,
        action: input.action,
        module: input.module,
        entityId: input.entityId ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
        details: input.details ? (input.details as object) : undefined,
      },
    });
  } catch (error) {
    logger.error('Failed to write audit log', { error, input });
  }
}
