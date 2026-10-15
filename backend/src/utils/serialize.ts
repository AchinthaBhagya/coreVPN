/**
 * Converts Prisma/custom values into JSON-safe primitives.
 * - Decimal -> string (never floating point, so money stays exact)
 * - Date -> ISO string
 * - BigInt -> string
 * Sensitive fields are stripped defensively.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'twoFactorSecret',
  'token',
  'tokenHash',
  'refreshToken',
  'secret',
  'encryptedValue',
]);

export function serialize<T>(value: T): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item) => serialize(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'object') {
    // Prisma Decimal instances expose toFixed/constructor name Decimal-like
    const anyValue = value as unknown as { toFixed?: unknown; constructor?: { name?: string }; s?: unknown };
    const ctorName = anyValue.constructor?.name;
    if (
      (ctorName === 'Decimal' || ctorName === 'PrismaDecimal' || typeof anyValue.toFixed === 'function') &&
      typeof anyValue.s !== 'undefined' &&
      typeof anyValue.toFixed === 'function'
    ) {
      try {
        return (anyValue as unknown as { toString: () => string }).toString();
      } catch {
        return String(value);
      }
    }

    if (value instanceof Buffer) {
      return '[buffer]';
    }

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key)) continue;
      result[key] = serialize(val);
    }
    return result;
  }

  return value;
}
