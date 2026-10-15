import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';
import { dummyPasswordHash, hashPassword, validatePasswordPolicy, verifyPassword } from '../utils/password';
import { generateOpaqueToken, sha256 } from '../utils/token';
import { writeAudit } from '../utils/audit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { authLimiter, sensitiveLimiter } from '../middleware/rateLimit';
import { ensureDefaultPreferences } from '../services/notificationService';
import { resetPasswordEmail, sendMail } from '../services/emailService';
import {
  clearAuthCookies,
  createSession,
  destroyAllSessionsForUser,
  destroySessionByRawToken,
  setAuthCookies,
  setCsrfCookie,
  SESSION_COOKIE,
} from '../services/sessionService';
import { toAuthUser, userAccessInclude } from './serializers';
import { ah } from './helpers';

export const authRouter = Router();

const passwordSchema = z.string().min(1, 'Password is required');

const loginSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: passwordSchema,
});

const changePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});

const forgotSchema = z.object({ email: z.string().email() });

const resetSchema = z.object({
  token: z.string().min(10, 'A valid reset token is required'),
  newPassword: passwordSchema,
});

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
});

function policyOrThrow(password: string): void {
  const result = validatePasswordPolicy(password);
  if (!result.valid) {
    const error = new AppError('Password does not meet the security policy', 422);
    (error as AppError & { errors?: unknown }).errors = result.errors.map((message) => ({
      field: 'newPassword',
      message,
    }));
    throw error;
  }
}

/** Issues a fresh CSRF cookie so the SPA can perform state-changing requests. */
authRouter.get(
  '/csrf',
  ah(async (req: AuthRequest, res) => {
    const existing = req.cookies?.['csrf'];
    const token = typeof existing === 'string' && existing ? existing : generateOpaqueToken(16);
    if (!existing) setCsrfCookie(res, token);
    return sendSuccess(res, { csrfToken: token });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  ah(async (req: AuthRequest, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
      include: userAccessInclude,
    });

    // Constant-ish response *and* constant-ish timing to avoid account enumeration.
    const storedHash = user ? user.password : await dummyPasswordHash();
    const passwordOk = await verifyPassword(password, storedHash);
    if (!user || !passwordOk) {
      throw new AppError('Invalid email or password', 401);
    }

    if (user.status !== 'ACTIVE') {
      throw new AppError('Your account is not active. Please contact an administrator.', 403);
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    await ensureDefaultPreferences(user.id).catch(() => undefined);

    const session = await createSession(user.id, req);
    setAuthCookies(res, session);

    await writeAudit(req, { action: 'auth.login', module: 'auth', entityId: user.id });

    return sendSuccess(res, { user: toAuthUser(user) });
  }),
);

authRouter.post(
  '/logout',
  authenticate,
  ah(async (req: AuthRequest, res) => {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (typeof raw === 'string' && raw) await destroySessionByRawToken(raw);
    clearAuthCookies(res);
    if (req.user) {
      await writeAudit(req, { action: 'auth.logout', module: 'auth', entityId: req.user.id });
    }
    return sendSuccess(res, { loggedOut: true });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  ah(async (req: AuthRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: userAccessInclude,
    });
    if (!user) throw new AppError('Account not found', 404);
    return sendSuccess(res, {
      user: {
        ...toAuthUser(user),
        phone: user.phone,
        lastLogin: user.lastLogin,
        twoFactorEnabled: user.twoFactorEnabled,
      },
    });
  }),
);

/** Rotates the session token (extends the session and invalidates the old token). */
authRouter.post(
  '/refresh',
  authenticate,
  ah(async (req: AuthRequest, res) => {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (typeof raw === 'string' && raw) await destroySessionByRawToken(raw);
    const session = await createSession(req.user!.id, req);
    setAuthCookies(res, session);
    return sendSuccess(res, { refreshed: true });
  }),
);

authRouter.patch(
  '/profile',
  authenticate,
  validate(profileSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof profileSchema>;
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.jobTitle !== undefined ? { jobTitle: data.jobTitle } : {}),
      },
      include: userAccessInclude,
    });
    await writeAudit(req, { action: 'auth.profile.update', module: 'auth', entityId: updated.id });
    return sendSuccess(res, { user: toAuthUser(updated) });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  ah(async (req: AuthRequest, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new AppError('Account not found', 404);
    if (!(await verifyPassword(currentPassword, user.password))) {
      throw new AppError('Your current password is incorrect', 400);
    }
    if (currentPassword === newPassword) {
      throw new AppError('The new password must be different from the current password', 422);
    }
    policyOrThrow(newPassword);

    await prisma.user.update({ where: { id: user.id }, data: { password: await hashPassword(newPassword) } });
    // Invalidate every existing session, then re-issue one for this browser.
    await destroyAllSessionsForUser(user.id);
    const session = await createSession(user.id, req);
    setAuthCookies(res, session);

    await writeAudit(req, { action: 'auth.password.change', module: 'auth', entityId: user.id });
    return sendSuccess(res, { changed: true }, { message: 'Password updated successfully' });
  }),
);

authRouter.post(
  '/forgot-password',
  sensitiveLimiter,
  validate(forgotSchema),
  ah(async (req: AuthRequest, res) => {
    const { email } = req.body as z.infer<typeof forgotSchema>;
    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(rawToken),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      const link = `${env.frontendUrl}/reset-password?token=${rawToken}`;
      const mail = resetPasswordEmail(`${user.firstName} ${user.lastName}`, link);
      await sendMail({ to: user.email, ...mail });
      await writeAudit(req, { action: 'auth.password.forgot', module: 'auth', entityId: user.id });
    }

    // Always the same message so the endpoint cannot be used to enumerate accounts.
    return sendSuccess(
      res,
      { requested: true },
      { message: 'If that email address is registered, a reset link has been sent.' },
    );
  }),
);

authRouter.post(
  '/reset-password',
  sensitiveLimiter,
  validate(resetSchema),
  ah(async (req: AuthRequest, res) => {
    const { token, newPassword } = req.body as z.infer<typeof resetSchema>;
    policyOrThrow(newPassword);

    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new AppError('This reset link is invalid or has expired', 400);
    }

    await prisma.user.update({
      where: { id: record.userId },
      data: { password: await hashPassword(newPassword) },
    });
    await prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await destroyAllSessionsForUser(record.userId);

    await writeAudit(req, { action: 'auth.password.reset', module: 'auth', entityId: record.userId });
    return sendSuccess(res, { reset: true }, { message: 'Your password has been reset. Please sign in.' });
  }),
);
