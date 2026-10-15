import { IntegrationProvider } from '@prisma/client';
import { prisma } from '../config/prisma';
import logger from '../config/logger';

export interface DiscordWebhookConfig {
  event: string;
  url: string;
  enabled: boolean;
  template?: string;
}

/**
 * Discord integration.
 *
 * Security rules implemented here:
 *  - Webhook URLs live only in the database/server environment. They are never
 *    returned to the browser (the settings API masks them).
 *  - Message content is sanitised (mentions neutralised, length capped).
 *  - Confidential data (passwords, full payment details) is never posted by
 *    default; message templates carry only references and amounts the owner
 *    chose to expose.
 *  - Every send is logged with retry + failure counters and duplicate-event
 *    prevention (via the notification dedupe key / job dedupe key).
 */
const MAX_LENGTH = 1800;

export function maskWebhookUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    const maskedLast = last ? `${last.slice(0, 4)}${'*'.repeat(Math.max(0, last.length - 4))}` : '';
    return `${parsed.origin}/api/webhooks/${maskedLast}`;
  } catch {
    return 'https://discord.com/api/webhooks/****';
  }
}

export function sanitizeDiscordContent(content: string): string {
  // Neutralise mass mentions and strip control characters
  const cleaned = content
    .replace(/@everyone/g, '@\u200beveryone')
    .replace(/@here/g, '@\u200bhere')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return cleaned.length > MAX_LENGTH ? `${cleaned.slice(0, MAX_LENGTH - 3)}...` : cleaned;
}

export class DiscordService {
  private cache: { at: number; settings: Map<string, { url: string; enabled: boolean }> } | null = null;

  private async loadSettings() {
    if (this.cache && Date.now() - this.cache.at < 15_000) return this.cache.settings;
    const rows = await prisma.integrationSetting.findMany({
      where: { provider: IntegrationProvider.DISCORD },
    });
    const map = new Map<string, { url: string; enabled: boolean }>();
    for (const row of rows) {
      if (row.key.startsWith('webhook.')) {
        const event = row.key.slice('webhook.'.length);
        map.set(event, { url: row.value ?? '', enabled: row.isEnabled && Boolean(row.value) });
      }
    }
    this.cache = { at: Date.now(), settings: map };
    return map;
  }

  invalidateCache() {
    this.cache = null;
  }

  async getConfig(): Promise<DiscordWebhookConfig[]> {
    const rows = await prisma.integrationSetting.findMany({
      where: { provider: IntegrationProvider.DISCORD },
      orderBy: { key: 'asc' },
    });
    return rows
      .filter((row) => row.key.startsWith('webhook.'))
      .map((row) => ({
        event: row.key.slice('webhook.'.length),
        url: sanitizeDiscordContent(row.value ?? ''),
        enabled: row.isEnabled && Boolean(row.value),
        template: undefined,
      }));
  }

  /**
   * Attempts delivery for a single event. Returns whether it was delivered.
   * Never throws - integration failures must not break business operations.
   */
  async dispatch(event: string, payload: { content?: string; embeds?: unknown[] }, dedupeKey?: string): Promise<boolean> {
    try {
      const settings = await this.loadSettings();
      const config = settings.get(event);
      const fallbackUrl = process.env.DISCORD_WEBHOOK_DEFAULT ?? '';
      const url = config?.enabled ? config.url : '';
      const target = url || fallbackUrl;
      const globallyEnabled = process.env.DISCORD_ENABLED === 'true';

      if (!target || (!globallyEnabled && !config?.enabled)) {
        return false;
      }

      if (dedupeKey) {
        const existing = await prisma.backgroundJob.findUnique({ where: { dedupeKey } }).catch(() => null);
        if (existing) return false;
      }

      const body: Record<string, unknown> = {};
      if (payload.content) body.content = sanitizeDiscordContent(payload.content);
      if (payload.embeds) body.embeds = payload.embeds;

      const delivered = await this.postWithRetry(target, body);

      if (dedupeKey) {
        await prisma.backgroundJob
          .create({
            data: {
              type: 'DISCORD_RETRY',
              status: delivered ? 'SUCCESS' : 'FAILED',
              dedupeKey,
              finishedAt: new Date(),
              attempts: 1,
              lastError: delivered ? null : 'Discord delivery failed after retries',
            },
          })
          .catch(() => undefined);
      }

      await prisma.integrationSetting.updateMany({
        where: { provider: IntegrationProvider.DISCORD, key: `webhook.${event}` },
        data: delivered
          ? { lastUsedAt: new Date(), lastError: null, failureCount: 0 }
          : { lastError: 'Delivery failed after retries', failureCount: { increment: 1 } },
      });

      return delivered;
    } catch (error) {
      logger.error('Discord dispatch error', { error, event });
      return false;
    }
  }

  private async postWithRetry(url: string, body: Record<string, unknown>): Promise<boolean> {
    const delays = [0, 400, 1200];
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt] > 0) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (response.ok || response.status === 204) return true;
        if (response.status === 429) continue; // rate limited -> retry
        if (response.status >= 400 && response.status < 500) return false; // bad payload/auth -> don't retry
      } catch (error) {
        logger.warn('Discord webhook attempt failed', { error, attempt: attempt + 1 });
      }
    }
    return false;
  }

  async testWebhook(event: string, url: string): Promise<{ ok: boolean; status?: number; error?: string }> {
    if (!/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\//.test(url)) {
      return { ok: false, error: 'URL does not look like a Discord webhook URL.' };
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: sanitizeDiscordContent(`3xCodz test webhook for event \`${event}\` - connectivity confirmed.`),
        }),
      });
      if (response.ok || response.status === 204) return { ok: true, status: response.status };
      return { ok: false, status: response.status, error: `Discord responded with ${response.status}` };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}

export const discordService = new DiscordService();
