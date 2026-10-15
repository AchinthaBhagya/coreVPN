import crypto from 'crypto';

/** Generates an opaque session/CSRF token. Only the hash is persisted server-side. */
export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Generates a human-readable sequential reference, e.g. PRJ-2026-0001 */
export function formatSequence(prefix: string, year: number, sequence: number, pad = 4): string {
  return `${prefix}${year}-${String(sequence).padStart(pad, '0')}`;
}
