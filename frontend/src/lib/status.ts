/** Maps domain enum strings (mirrors prisma/schema.prisma) to presentation intent. */

export type Tone = "default" | "primary" | "success" | "warning" | "danger" | "info" | "muted";

const STATUS_TONES: Record<string, Tone> = {
  // user
  ACTIVE: "success",
  INACTIVE: "muted",
  PENDING: "warning",
  SUSPENDED: "danger",
  // client
  LEAD: "info",
  PROSPECT: "primary",
  ARCHIVED: "muted",
  // generic workflow
  DRAFT: "muted",
  SUBMITTED: "info",
  CONFIRMED: "primary",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "danger",
  DELIVERED: "success",
  COMPLETED: "success",
  VOID: "muted",
  // leads
  NEW: "info",
  CONTACTED: "info",
  QUALIFIED: "primary",
  PROPOSAL_SENT: "primary",
  NEGOTIATION: "warning",
  WON: "success",
  LOST: "danger",
  // quotation / invoice
  SENT: "info",
  ACCEPTED: "success",
  EXPIRED: "muted",
  ISSUED: "info",
  UNPAID: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "danger",
  REFUNDED: "muted",
  // projects
  INQUIRY: "info",
  QUOTATION: "info",
  AWAITING_PAYMENT: "warning",
  PLANNING: "info",
  IN_PROGRESS: "primary",
  ON_HOLD: "warning",
  REVIEW: "warning",
  CLIENT_APPROVAL: "warning",
  REVISION_REQUESTED: "danger",
  // tasks / revisions / milestones
  TODO: "muted",
  IN_REVIEW: "warning",
  BLOCKED: "danger",
  DONE: "success",
  OPEN: "info",
  RESOLVED: "success",
  CLOSED: "muted",
  // tickets
  WAITING_CLIENT: "warning",
  // priority
  LOW: "muted",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "danger",
  // time
  // earnings / payouts
  PENDING_APPROVAL: "warning",
  // refunds
  CREDIT_NOTE: "info",
  REFUND: "warning",
};

export function toneForStatus(status: string | null | undefined): Tone {
  if (!status) return "default";
  return STATUS_TONES[status.toUpperCase()] ?? "default";
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "-";
  return status
    .toLowerCase()
    .split(/[_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Enum option lists mirrored from prisma/schema.prisma for selects. */
export const OPTIONS = {
  clientType: ["INDIVIDUAL", "BUSINESS"] as const,
  clientStatus: ["LEAD", "PROSPECT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const,
  leadStatus: ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"] as const,
  pricingModel: ["FIXED", "HOURLY", "DAILY", "MONTHLY", "PROJECT_BASED", "CUSTOM"] as const,
  serviceStatus: ["ACTIVE", "INACTIVE", "ARCHIVED"] as const,
  quotationStatus: ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"] as const,
  orderStatus: ["DRAFT", "SUBMITTED", "CONFIRMED", "IN_PROGRESS", "DELIVERED", "CANCELLED"] as const,
  projectStatus: ["INQUIRY", "QUOTATION", "AWAITING_PAYMENT", "PLANNING", "IN_PROGRESS", "ON_HOLD", "REVIEW", "CLIENT_APPROVAL", "REVISION_REQUESTED", "COMPLETED", "CANCELLED"] as const,
  priority: ["LOW", "MEDIUM", "HIGH", "URGENT"] as const,
  taskStatus: ["TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE", "CANCELLED"] as const,
  timeStatus: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const,
  invoiceStatus: ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID", "REFUNDED"] as const,
  paymentMethod: ["CASH", "BANK_TRANSFER", "CARD", "ONLINE_GATEWAY", "PAYPAL", "CRYPTO", "OTHER"] as const,
  refundKind: ["REFUND", "CREDIT_NOTE"] as const,
  expenseStatus: ["DRAFT", "PENDING", "APPROVED", "REJECTED", "PAID"] as const,
  expenseFrequency: ["NONE", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const,
  ticketCategory: ["GENERAL", "BILLING", "TECHNICAL", "PROJECT", "REVISION", "OTHER"] as const,
  ticketStatus: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "RESOLVED", "CLOSED"] as const,
  allocationModel: ["FIXED", "PERCENT_OF_REVENUE", "PERCENT_OF_PROFIT"] as const,
  milestoneStatus: ["PENDING", "IN_PROGRESS", "COMPLETED"] as const,
  revisionStatus: ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"] as const,
} as const;
