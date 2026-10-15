import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { env, googleOAuthEnabled, googleRedirectUri } from '../config/env';
import { AppError } from '../utils/AppError';
import { sendCreated, sendSuccess } from '../utils/apiResponse';
import { dummyPasswordHash, hashPassword, validatePasswordPolicy, verifyPassword } from '../utils/password';
import { generateOpaqueToken, sha256 } from '../utils/token';
import { writeAudit } from '../utils/audit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { authLimiter, sensitiveLimiter } from '../middleware/rateLimit';
import { ensureDefaultPreferences } from '../services/notificationService';
import { resetPasswordEmail, sendMail, verificationEmail } from '../services/emailService';
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

/* --------------------------- Self-service accounts -------------------------- */

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

const registerSchema = z.object({
  accountType: z.enum(['STAFF', 'CLIENT']),
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  email: z.string().email('A valid email is required'),
  password: passwordSchema,
  phone: z.string().trim().max(40).nullable().optional(),
  companyName: z.string().trim().max(160).nullable().optional(),
});

/** Issues a single-use email-verification token and returns the raw value (only time it exists). */
async function issueVerificationToken(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.emailVerificationToken.create({
      data: { userId, tokenHash: sha256(rawToken), expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) },
    }),
  ]);
  return rawToken;
}

/** Sends the verification email. Returns whether it was actually dispatched. */
async function sendVerificationEmail(user: { id: string; email: string; firstName: string }): Promise<boolean> {
  const rawToken = await issueVerificationToken(user.id);
  const link = `${env.frontendUrl.replace(/\/$/, '')}/verify-email?token=${rawToken}`;
  return sendMail({ to: user.email, ...verificationEmail(user.firstName, link) });
}

/** Read-only list of enabled sign-in providers so the SPA can adapt its UI. */
authRouter.get(
  '/providers',
  ah(async (_req: AuthRequest, res) => {
    return sendSuccess(res, { google: googleOAuthEnabled });
  }),
);

/**
 * Public self-service registration.
 * - STAFF  -> created PENDING; an owner must approve and assign a role.
 * - CLIENT -> a client record is created, the "Client" role assigned, and an
 *             email-verification link is sent; the account activates on verify.
 */
authRouter.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  ah(async (req: AuthRequest, res) => {
    const data = req.body as z.infer<typeof registerSchema>;
    const email = data.email.toLowerCase();

    policyOrThrow(data.password);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError('An account with this email already exists. Try signing in instead.', 409);
    }

    if (data.accountType === 'STAFF') {
      const user = await prisma.user.create({
        data: {
          email,
          password: await hashPassword(data.password),
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone ?? null,
          status: 'PENDING',
        },
      });
      await writeAudit(req, {
        action: 'auth.register',
        module: 'auth',
        entityId: user.id,
        details: { accountType: 'STAFF' },
      });
      return sendCreated(
        res,
        { accountType: 'STAFF', status: user.status, emailVerified: false, mailSent: false },
        'Account created. An administrator must approve it before you can sign in.',
      );
    }

    const clientRole = await prisma.role.findUnique({ where: { name: 'Client' } });
    if (!clientRole) {
      throw new AppError('The client portal role is not configured. Please contact an administrator.', 500);
    }

    // Client.email is unique, so reuse an existing (unlinked) client record when present.
    const existingClient = await prisma.client.findUnique({ where: { email } });
    if (existingClient?.userId) {
      throw new AppError('An account with this email already exists. Try signing in instead.', 409);
    }

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: await hashPassword(data.password),
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone ?? null,
          status: 'PENDING',
          userRoles: { create: [{ roleId: clientRole.id }] },
        },
      });
      const client = existingClient
        ? await tx.client.update({ where: { id: existingClient.id }, data: { userId: user.id } })
        : await tx.client.create({
            data: {
              userId: user.id,
              type: data.companyName ? 'BUSINESS' : 'INDIVIDUAL',
              companyName: data.companyName ?? null,
              firstName: data.firstName,
              lastName: data.lastName,
              email,
              phone: data.phone ?? null,
              status: 'ACTIVE',
            },
          });
      return { user, client };
    });

    const mailSent = await sendVerificationEmail(created.user).catch(() => false);
    await writeAudit(req, {
      action: 'auth.register',
      module: 'auth',
      entityId: created.user.id,
      details: { accountType: 'CLIENT', clientId: created.client.id, mailSent },
    });

    return sendCreated(
      res,
      { accountType: 'CLIENT', status: created.user.status, emailVerified: false, mailSent },
      mailSent
        ? 'Account created. Check your email to verify your address.'
        : 'Account created. We could not send the verification email - please contact support.',
    );
  }),
);

authRouter.post(
  '/verify-email',
  sensitiveLimiter,
  validate(z.object({ token: z.string().min(10, 'A verification token is required') })),
  ah(async (req: AuthRequest, res) => {
    const { token } = req.body as { token: string };
    const record = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now() || record.user.deletedAt) {
      throw new AppError('This verification link is invalid or has expired', 400);
    }

    const activated = record.user.status === 'PENDING';
    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date(), ...(activated ? { status: 'ACTIVE' } : {}) },
      }),
      prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    await writeAudit(req, {
      action: 'auth.email.verify',
      module: 'auth',
      entityId: record.userId,
      details: { activated },
    });

    return sendSuccess(res, { verified: true, activated }, { message: 'Your email has been verified. You can now sign in.' });
  }),
);

authRouter.post(
  '/resend-verification',
  sensitiveLimiter,
  validate(z.object({ email: z.string().email() })),
  ah(async (req: AuthRequest, res) => {
    const { email } = req.body as { email: string };
    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
    if (user && !user.emailVerifiedAt) {
      const mailSent = await sendVerificationEmail(user).catch(() => false);
      await writeAudit(req, { action: 'auth.email.resend', module: 'auth', entityId: user.id, details: { mailSent } });
    }
    // Always the same response so the endpoint cannot be used to enumerate accounts.
    return sendSuccess(
      res,
      { requested: true },
      { message: 'If that account still needs verification, a new link has been sent.' },
    );
  }),
);

/* -------------------------------- Google OAuth ------------------------------ */

const GOOGLE_STATE_COOKIE = 'g_oauth';

interface GoogleClaims {
  email?: string;
  email_verified?: string | boolean;
  sub?: string;
  aud?: string;
  given_name?: string;
  family_name?: string;
}

authRouter.get(
  '/google',
  ah(async (req: AuthRequest, res) => {
    if (!googleOAuthEnabled) throw new AppError('Google sign-in is not configured', 503);
    const type = req.query.type === 'CLIENT' ? 'CLIENT' : req.query.type === 'STAFF' ? 'STAFF' : '';
    const state = crypto.randomBytes(24).toString('hex');
    res.cookie(GOOGLE_STATE_COOKIE, `${state}:${type}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProduction,
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
    const params = new URLSearchParams({
      client_id: env.google.clientId,
      redirect_uri: googleRedirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    });
    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  }),
);

/**
 * Google redirect target. It both signs in existing accounts and (when a type was
 * chosen on the register page) creates new ones, then hands control back to the SPA.
 */
authRouter.get(
  '/google/callback',
  ah(async (req: AuthRequest, res) => {
    const frontend = env.frontendUrl.replace(/\/$/, '');
    const fail = (code: string) => res.redirect(`${frontend}/auth/callback?error=${encodeURIComponent(code)}`);
    const succeed = (next: string) =>
      res.redirect(`${frontend}/auth/callback?status=success&next=${encodeURIComponent(next)}`);

    if (!googleOAuthEnabled) return fail('google_not_configured');

    const { code, state } = req.query as { code?: string; state?: string };
    const rawState = req.cookies?.[GOOGLE_STATE_COOKIE];
    res.clearCookie(GOOGLE_STATE_COOKIE, { path: '/' });
    const [expectedState, requestedType] = String(rawState ?? '').split(':');
    if (!code || !state || !expectedState || state !== expectedState) return fail('invalid_state');

    let idToken: string | undefined;
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.google.clientId,
          client_secret: env.google.clientSecret,
          redirect_uri: googleRedirectUri(),
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) return fail('token_exchange_failed');
      idToken = ((await tokenRes.json()) as { id_token?: string }).id_token;
    } catch {
      return fail('token_exchange_failed');
    }
    if (!idToken) return fail('token_exchange_failed');

    // Verify signature/issuer/audience server-side before trusting the claims.
    let claims: GoogleClaims;
    try {
      const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!infoRes.ok) return fail('invalid_id_token');
      claims = (await infoRes.json()) as GoogleClaims;
    } catch {
      return fail('invalid_id_token');
    }
    if (!claims.email || claims.aud !== env.google.clientId) return fail('invalid_id_token');

    const email = claims.email.toLowerCase();
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';

    const existing = await prisma.user.findFirst({ where: { email, deletedAt: null }, include: userAccessInclude });

    if (existing) {
      const authUser = toAuthUser(existing);
      const canActivate = emailVerified && authUser.isClient;
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          googleId: existing.googleId ?? claims.sub ?? undefined,
          emailVerifiedAt: existing.emailVerifiedAt ?? (emailVerified ? new Date() : undefined),
          ...(existing.status !== 'ACTIVE' && canActivate ? { status: 'ACTIVE' } : {}),
        },
      });
      if (existing.status !== 'ACTIVE' && !canActivate) {
        return fail(authUser.isClient ? 'email_not_verified' : 'pending_approval');
      }
      await ensureDefaultPreferences(existing.id).catch(() => undefined);
      const session = await createSession(existing.id, req);
      setAuthCookies(res, session);
      await prisma.user.update({ where: { id: existing.id }, data: { lastLogin: new Date() } });
      await writeAudit(req, {
        action: 'auth.login',
        module: 'auth',
        entityId: existing.id,
        details: { provider: 'google' },
      });
      return succeed(authUser.isClient ? '/portal' : '/dashboard');
    }

    // No account yet - Google sign-up happens only when a type was chosen on the register page.
    if (requestedType === 'CLIENT') {
      const clientRole = await prisma.role.findUnique({ where: { name: 'Client' } });
      if (!clientRole) return fail('client_role_missing');
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            password: await hashPassword(crypto.randomBytes(32).toString('hex')),
            firstName: claims.given_name?.trim() || email.split('@')[0],
            lastName: claims.family_name?.trim() || 'Client',
            status: 'ACTIVE',
            googleId: claims.sub ?? null,
            emailVerifiedAt: emailVerified ? new Date() : null,
            userRoles: { create: [{ roleId: clientRole.id }] },
          },
        });
        await tx.client.create({
          data: {
            userId: user.id,
            type: 'INDIVIDUAL',
            firstName: user.firstName,
            lastName: user.lastName,
            email,
            status: 'ACTIVE',
          },
        });
        return user;
      });
      await ensureDefaultPreferences(created.id).catch(() => undefined);
      const session = await createSession(created.id, req);
      setAuthCookies(res, session);
      await writeAudit(req, {
        action: 'auth.register',
        module: 'auth',
        entityId: created.id,
        details: { accountType: 'CLIENT', provider: 'google' },
      });
      return succeed('/portal');
    }

    if (requestedType === 'STAFF') {
      const created = await prisma.user.create({
        data: {
          email,
          password: await hashPassword(crypto.randomBytes(32).toString('hex')),
          firstName: claims.given_name?.trim() || email.split('@')[0],
          lastName: claims.family_name?.trim() || 'Member',
          status: 'PENDING',
          googleId: claims.sub ?? null,
          emailVerifiedAt: emailVerified ? new Date() : null,
        },
      });
      await writeAudit(req, {
        action: 'auth.register',
        module: 'auth',
        entityId: created.id,
        details: { accountType: 'STAFF', provider: 'google' },
      });
      return fail('pending_approval');
    }

    return fail('no_account');
  }),
);
