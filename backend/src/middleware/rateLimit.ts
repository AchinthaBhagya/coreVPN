import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const skip = () => env.isTest;

/** Broad API limiter. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { success: false, message: 'Too many requests. Please slow down and try again shortly.' },
});

/** Aggressive limiter for authentication endpoints (login throttling). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip,
  message: { success: false, message: 'Too many authentication attempts. Please try again in 15 minutes.' },
});

/** Limiter for password reset / email sending to prevent abuse. */
export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { success: false, message: 'Too many requests for this action. Please try again later.' },
});
