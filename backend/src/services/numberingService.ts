import { prisma } from '../config/prisma';
import { formatSequence } from '../utils/token';

export interface NumberingContext {
  invoicePrefix?: string;
  quotationPrefix?: string;
  orderPrefix?: string;
  projectPrefix?: string;
}

async function companyPrefixes(): Promise<Required<NumberingContext>> {
  const settings = await prisma.companySetting.findUnique({ where: { id: 'default' } });
  return {
    invoicePrefix: settings?.invoicePrefix ?? 'INV-',
    quotationPrefix: settings?.quotationPrefix ?? 'QT-',
    orderPrefix: settings?.orderPrefix ?? 'ORD-',
    projectPrefix: settings?.projectPrefix ?? 'PRJ-',
  };
}

/**
 * Atomically increments a document counter inside a transaction so concurrent
 * requests can never receive the same number. Uses MySQL
 * `INSERT ... ON DUPLICATE KEY UPDATE` for atomicity.
 */
export async function nextNumber(
  tx: {
    $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
    $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  },
  prefix: string,
  scope = new Date().getFullYear(),
): Promise<string> {
  const key = `${prefix}${scope}`;
  await tx.$executeRaw`
    INSERT INTO DocumentCounter (id, counterKey, value, updatedAt)
    VALUES (CONCAT('dc_', REPLACE(UUID(), '-', '')), ${key}, 1, NOW())
    ON DUPLICATE KEY UPDATE value = value + 1, updatedAt = NOW()
  `;
  const rows = await tx.$queryRaw<Array<{ value: number | bigint }>>`
    SELECT value FROM DocumentCounter WHERE counterKey = ${key}
  `;
  const raw = rows[0]?.value ?? 1;
  const value = typeof raw === 'bigint' ? Number(raw) : Number(raw);
  return formatSequence(prefix, scope, value);
}

export const numbering = {
  companyPrefixes,
  async invoiceNumber(tx: Parameters<typeof nextNumber>[0]) {
    const { invoicePrefix } = await companyPrefixes();
    return nextNumber(tx, invoicePrefix);
  },
  async quotationNumber(tx: Parameters<typeof nextNumber>[0]) {
    const { quotationPrefix } = await companyPrefixes();
    return nextNumber(tx, quotationPrefix);
  },
  async orderNumber(tx: Parameters<typeof nextNumber>[0]) {
    const { orderPrefix } = await companyPrefixes();
    return nextNumber(tx, orderPrefix);
  },
  async projectNumber(tx: Parameters<typeof nextNumber>[0]) {
    const { projectPrefix } = await companyPrefixes();
    return nextNumber(tx, projectPrefix);
  },
  async paymentNumber(tx: Parameters<typeof nextNumber>[0]) {
    return nextNumber(tx, 'PAY-');
  },
  async refundNumber(tx: Parameters<typeof nextNumber>[0]) {
    return nextNumber(tx, 'RF-');
  },
  async expenseNumber(tx: Parameters<typeof nextNumber>[0]) {
    return nextNumber(tx, 'EXP-');
  },
  async ticketNumber(tx: Parameters<typeof nextNumber>[0]) {
    return nextNumber(tx, 'TCK-');
  },
  async payoutNumber(tx: Parameters<typeof nextNumber>[0]) {
    return nextNumber(tx, 'PO-');
  },
};
