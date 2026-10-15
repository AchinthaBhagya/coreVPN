import { z } from "zod";

/**
 * Client-side mirror of the server password policy (`backend/src/utils/password.ts`).
 * The server always re-validates - this exists purely for fast feedback.
 */
export const passwordPolicy = {
  minLength: 10,
  summary: "At least 10 characters including uppercase, lowercase, a number and a symbol.",
} as const;

export const passwordSchema = z
  .string()
  .min(passwordPolicy.minLength, `Password must be at least ${passwordPolicy.minLength} characters long.`)
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[0-9]/, "Password must include a number.")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol.");

/** Currency code helper (3 letters, upper-cased). */
export const currencyValue = z
  .string()
  .trim()
  .length(3, "Currency must be a 3-letter code")
  .transform((value) => value.toUpperCase());
