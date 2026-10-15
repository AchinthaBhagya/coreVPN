import { prisma } from '../config/prisma';

export interface ActivityInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  projectId?: string | null;
  clientId?: string | null;
  isClientVisible?: boolean;
}

/**
 * Records business activity for timelines (project, client, ticket...).
 * Distinct from AuditLog which captures security-relevant changes.
 */
export async function logActivity(input: ActivityInput) {
  try {
    return await prisma.activityLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        metadata: input.metadata ? (input.metadata as object) : undefined,
        projectId: input.projectId ?? null,
        clientId: input.clientId ?? null,
        isClientVisible: input.isClientVisible ?? false,
      },
    });
  } catch {
    // Activity logging must never break a business operation
    return null;
  }
}
