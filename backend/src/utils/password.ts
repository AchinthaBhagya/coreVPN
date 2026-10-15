import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Password hashing uses bcrypt (adaptive, salted). bcryptjs is a pure-JS
 * implementation so deployments do not require native build tooling.
 * Never store or log plaintext passwords.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(env.bcryptRounds);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * Hash compared against when a login references an unknown email. Always
 * performing a bcrypt comparison keeps the response timing independent of
 * whether the account exists (no account-enumeration side channel).
 */
export function dummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(crypto.randomBytes(24).toString('hex'));
  }
  return dummyHashPromise;
}

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

/** Server-side password policy - applied even if the UI already validates. */
export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 10) errors.push('Password must be at least 10 characters long.');
  if (!/[A-Z]/.test(password)) errors.push('Password must include an uppercase letter.');
  if (!/[a-z]/.test(password)) errors.push('Password must include a lowercase letter.');
  if (!/[0-9]/.test(password)) errors.push('Password must include a number.');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Password must include a symbol.');
  return { valid: errors.length === 0, errors };
}
