import { Router } from 'express';
import { z } from 'zod';
import { IntegrationProvider } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { sendNoContent, sendSuccess } from '../utils/apiResponse';
import { writeAudit } from '../utils/audit';
import { discordService, maskWebhookUrl } from '../services/discordService';
import { sendMail } from '../services/emailService';
import { authenticate, AuthRequest } from '../middleware/auth';
import { denyClients, requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { ah } from './helpers';

export const integrationsRouter = Router();

integrationsRouter.use(authenticate, denyClients());

/** Canonical Discord events the company can subscribe a webhook to. */
const DISCORD_EVENTS = [
  'lead.created',
  'order.created',
  'quotation.accepted',
  'project.created',
  'project.completed',
  'invoice.issued',
  'payment.recorded',
  'ticket.created',
  'ticket.reply',
  'payout.approved',
] as const;

const MASKED_PLACEHOLDER = /^\*+$|^https:\/\/discord(app)?\.com\/api\/webhooks\/[^/]*\*+$/;

const discordSchema = z.object({
  event: z.string().trim().min(2).max(80),
  url: z.string().trim().max(500).nullable().optional(),
  isEnabled: z.boolean().optional(),
  template: z.string().max(2000).nullable().optional(),
});

const discordTestSchema = z.object({
  event: z.string().trim().min(2).max(80),
  url: z.string().trim().max(500).optional(),
});

const smtpSchema = z.object({
  host: z.string().trim().max(255).nullable().optional(),
  port: z.union([z.number(), z.string()]).nullable().optional(),
  user: z.string().trim().max(255).nullable().optional(),
  pass: z.string().max(500).nullable().optional(),
  from: z.string().trim().max(255).nullable().optional(),
  secure: z.boolean().optional(),
});

const smtpTestSchema = z.object({ to: z.string().email() });

function isMasked(value: string | null | undefined): boolean {
  if (!value) return false;
  return MASKED_PLACEHOLDER.test(value) || value.includes('****');
}

async function upsertSetting(
  provider: IntegrationProvider,
  key: string,
  value: string | null | undefined,
  options: { isSecret?: boolean; isEnabled?: boolean; updatedById?: string; description?: string } = {},
) {
  return prisma.integrationSetting.upsert({
    where: { provider_key: { provider, key } },
    update: {
      ...(value !== undefined ? { value } : {}),
      ...(options.isSecret !== undefined ? { isSecret: options.isSecret } : {}),
      ...(options.isEnabled !== undefined ? { isEnabled: options.isEnabled } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
      ...(options.updatedById ? { updatedById: options.updatedById } : {}),
    },
    create: {
      provider,
      key,
      value: value ?? null,
      isSecret: options.isSecret ?? false,
      isEnabled: options.isEnabled ?? true,
      description: options.description,
      updatedById: options.updatedById ?? null,
    },
  });
}

/* --------------------------------- Discord -------------------------------- */

integrationsRouter.get(
  '/discord',
  requirePermission('settings.integrations'),
  ah(async (_req: AuthRequest, res) => {
    const config = await discordService.getConfig();
    const byEvent = new Map(config.map((row) => [row.event, row]));
    const masked = DISCORD_EVENTS.map((event) => {
      const stored = byEvent.get(event);
      return {
        event,
        maskedUrl: stored?.url ? maskWebhookUrl(stored.url) : null,
        hasWebhook: Boolean(stored?.url),
        isEnabled: stored?.enabled ?? false,
        lastError: null as string | null,
      };
    });
    return sendSuccess(res, { events: masked, available: DISCORD_EVENTS });
  }),
);

integrationsRouter.put(
  '/discord',
  requirePermission('settings.integrations'),
  validate(discordSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof discordSchema>;
    const key = `webhook.${data.event}`;

    const existing = await prisma.integrationSetting.findUnique({
      where: { provider_key: { provider: IntegrationProvider.DISCORD, key } },
    });

    const wantsToChangeUrl = data.url !== undefined && data.url !== null && !isMasked(data.url);
    const clearing = data.url === null || data.url === '';

    if (data.url && isMasked(data.url)) {
      throw new AppError('Submit the full webhook URL to change it (masked values cannot be saved).', 422);
    }
    if (wantsToChangeUrl && !/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(data.url!)) {
      throw new AppError('That does not look like a Discord webhook URL.', 422);
    }

    const row = await upsertSetting(IntegrationProvider.DISCORD, key, clearing ? null : wantsToChangeUrl ? data.url! : undefined, {
      isSecret: true,
      isEnabled: data.isEnabled ?? (existing?.isEnabled ?? true),
      updatedById: req.user!.id,
      description: `Discord webhook for ${data.event}`,
    });

    if (data.template !== undefined) {
      await upsertSetting(IntegrationProvider.DISCORD, `template.${data.event}`, data.template, {
        isSecret: false,
        updatedById: req.user!.id,
        description: `Discord template for ${data.event}`,
      });
    }

    discordService.invalidateCache();
    await writeAudit(req, { action: 'integration.discord.update', module: 'settings', entityId: row.id, details: { event: data.event, cleared: clearing } });

    // Never echo the value back - only a masked confirmation.
    return sendSuccess(
      res,
      {
        event: data.event,
        maskedUrl: row.value ? maskWebhookUrl(row.value) : null,
        isEnabled: row.isEnabled,
      },
      { message: 'Discord webhook saved' },
    );
  }),
);

integrationsRouter.delete(
  '/discord/:event',
  requirePermission('settings.integrations'),
  ah(async (req: AuthRequest, res) => {
    const key = `webhook.${req.params.event}`;
    const existing = await prisma.integrationSetting.findUnique({
      where: { provider_key: { provider: IntegrationProvider.DISCORD, key } },
    });
    if (!existing) throw new AppError('Discord webhook not found', 404);
    await prisma.integrationSetting.delete({ where: { id: existing.id } });
    discordService.invalidateCache();
    await writeAudit(req, { action: 'integration.discord.delete', module: 'settings', entityId: existing.id });
    return sendNoContent(res);
  }),
);

integrationsRouter.post(
  '/discord/test',
  requirePermission('settings.integrations'),
  validate(discordTestSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof discordTestSchema>;
    let target = data.url && !isMasked(data.url) ? data.url : undefined;

    if (!target) {
      const stored = await prisma.integrationSetting.findUnique({
        where: { provider_key: { provider: IntegrationProvider.DISCORD, key: `webhook.${data.event}` } },
      });
      if (!stored?.value) throw new AppError('No webhook URL is stored for this event. Provide one to test.', 422);
      target = stored.value;
    }

    const result = await discordService.testWebhook(data.event, target);
    await writeAudit(req, { action: 'integration.discord.test', module: 'settings', details: { event: data.event, ok: result.ok } });
    if (!result.ok) {
      throw new AppError(result.error ?? 'Discord test failed', 502);
    }
    return sendSuccess(res, { ok: true, status: result.status ?? null }, { message: 'Test message delivered to Discord' });
  }),
);

/* ----------------------------------- SMTP ---------------------------------- */

integrationsRouter.get(
  '/smtp',
  requirePermission('settings.integrations'),
  ah(async (_req: AuthRequest, res) => {
    const rows = await prisma.integrationSetting.findMany({ where: { provider: IntegrationProvider.SMTP } });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return sendSuccess(res, {
      host: byKey.get('smtp.host')?.value ?? null,
      port: byKey.get('smtp.port')?.value ?? null,
      user: byKey.get('smtp.user')?.value ?? null,
      from: byKey.get('smtp.from')?.value ?? null,
      hasPassword: Boolean(byKey.get('smtp.pass')?.value),
      configured: Boolean(byKey.get('smtp.host')?.value),
    });
  }),
);

integrationsRouter.put(
  '/smtp',
  requirePermission('settings.integrations'),
  validate(smtpSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof smtpSchema>;

    const setKey = async (key: string, value: string | undefined, isSecret = false) => {
      if (value === undefined) return;
      await upsertSetting(IntegrationProvider.SMTP, key, value === '' ? null : value, {
        isSecret,
        updatedById: req.user!.id,
      });
    };

    await setKey('smtp.host', data.host ?? undefined);
    if (data.port !== undefined && data.port !== null) {
      const port = Number(data.port);
      if (!Number.isFinite(port) || port <= 0 || port > 65535) throw new AppError('SMTP port is invalid', 422);
      await setKey('smtp.port', String(port));
    }
    await setKey('smtp.user', data.user ?? undefined);
    // Treat masked/blank password submissions as "leave unchanged".
    if (data.pass !== undefined && data.pass !== null && data.pass !== '' && !isMasked(data.pass)) {
      await setKey('smtp.pass', data.pass, true);
    }
    await setKey('smtp.from', data.from ?? undefined);

    await writeAudit(req, { action: 'integration.smtp.update', module: 'settings' });

    const rows = await prisma.integrationSetting.findMany({ where: { provider: IntegrationProvider.SMTP } });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return sendSuccess(
      res,
      {
        host: byKey.get('smtp.host')?.value ?? null,
        port: byKey.get('smtp.port')?.value ?? null,
        user: byKey.get('smtp.user')?.value ?? null,
        from: byKey.get('smtp.from')?.value ?? null,
        hasPassword: Boolean(byKey.get('smtp.pass')?.value),
        configured: Boolean(byKey.get('smtp.host')?.value),
      },
      { message: 'SMTP settings saved' },
    );
  }),
);

integrationsRouter.post(
  '/smtp/test',
  requirePermission('settings.integrations'),
  validate(smtpTestSchema),
  ah(async (req: AuthRequest, res) => {
    const { to } = req.body as z.infer<typeof smtpTestSchema>;
    const ok = await sendMail({
      to,
      subject: '3xCodz SMTP test',
      html: '<p>This is a test email from your 3xCodz management system. If you received it, SMTP is configured correctly.</p>',
    });
    await writeAudit(req, { action: 'integration.smtp.test', module: 'settings', details: { ok } });
    if (!ok) {
      throw new AppError('SMTP is not configured or the test email could not be sent. Check the SMTP settings.', 502);
    }
    return sendSuccess(res, { ok: true }, { message: 'Test email sent' });
  }),
);

// Guard against ever returning a stored secret through the generic listing.
integrationsRouter.get(
  '/',
  requirePermission('settings.integrations'),
  ah(async (_req: AuthRequest, res) => {
    const rows = await prisma.integrationSetting.findMany({ orderBy: [{ provider: 'asc' }, { key: 'asc' }] });
    const safe = rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      key: row.key,
      value: row.isSecret ? null : row.value,
      isSecret: row.isSecret,
      isEnabled: row.isEnabled,
      description: row.description,
      failureCount: row.failureCount,
      lastError: row.lastError,
      lastUsedAt: row.lastUsedAt,
      updatedAt: row.updatedAt,
    }));
    return sendSuccess(res, safe);
  }),
);
