import nodemailer, { Transporter } from 'nodemailer';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import logger from '../config/logger';

let transporter: Transporter | null = null;

/**
 * Resolves SMTP configuration: database integration settings take priority over
 * environment variables so an owner can configure mail from the UI.
 */
async function resolveTransport(): Promise<Transporter | null> {
  let host = env.smtp.host;
  let port = env.smtp.port;
  let user = env.smtp.user;
  let pass = env.smtp.pass;
  let from = env.smtp.from;

  const rows = await prisma.integrationSetting.findMany({ where: { provider: 'SMTP' } });
  for (const row of rows) {
    if (!row.isEnabled || !row.value) continue;
    switch (row.key) {
      case 'smtp.host': host = row.value; break;
      case 'smtp.port': port = Number(row.value); break;
      case 'smtp.user': user = row.value; break;
      case 'smtp.pass': pass = row.value; break;
      case 'smtp.from': from = row.value; break;
      default: break;
    }
  }

  if (!host) return null;

  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
  (transporter as Transporter & { defaultFrom?: string }).defaultFrom = from;
  return transporter;
}

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Sends transactional email. When SMTP is not configured the message is logged
 * and skipped rather than throwing, so the business action still succeeds.
 * Sending an email never marks an invoice paid or completes any workflow.
 */
export async function sendMail(payload: MailPayload): Promise<boolean> {
  try {
    const transport = await resolveTransport();
    if (!transport) {
      logger.info('SMTP not configured - email skipped', { to: payload.to, subject: payload.subject });
      return false;
    }
    const from = (transport as Transporter & { defaultFrom?: string }).defaultFrom ?? env.smtp.from;
    await transport.sendMail({ from, to: payload.to, subject: payload.subject, html: payload.html, text: payload.text });
    return true;
  } catch (error) {
    logger.error('Failed to send email', { error, to: payload.to, subject: payload.subject });
    return false;
  }
}

export function resetPasswordEmail(name: string, link: string) {
  return {
    subject: '3xCodz - Reset your password',
    html: `<p>Hi ${escapeHtml(name)},</p><p>Use the link below to reset your 3xCodz password. It expires in 60 minutes.</p><p><a href="${link}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  };
}

export function invoiceEmail(invoiceNo: string, clientName: string, total: string, dueDate: string) {
  return {
    subject: `Invoice ${invoiceNo} from 3xCodz`,
    html: `<p>Hello ${escapeHtml(clientName)},</p><p>Invoice <strong>${escapeHtml(invoiceNo)}</strong> for <strong>${escapeHtml(total)}</strong> has been issued and is due on ${escapeHtml(dueDate)}.</p><p>You can view and download it from your client portal.</p>`,
  };
}

export function quotationEmail(quotationNo: string, clientName: string, total: string) {
  return {
    subject: `Quotation ${quotationNo} from 3xCodz`,
    html: `<p>Hello ${escapeHtml(clientName)},</p><p>Quotation <strong>${escapeHtml(quotationNo)}</strong> for <strong>${escapeHtml(total)}</strong> is ready for your review in the client portal.</p>`,
  };
}

export function verificationEmail(name: string, link: string) {
  return {
    subject: '3xCodz - Verify your email address',
    html: `<p>Hi ${escapeHtml(name)},</p><p>Welcome to 3xCodz. Please confirm your email address to activate your account. This link expires in 24 hours.</p><p><a href="${link}">Verify email address</a></p><p>If you did not create this account, you can ignore this email.</p>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
