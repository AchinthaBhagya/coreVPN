import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";

/**
 * Money is stored as DECIMAL on the server and serialised as a string. These
 * helpers format - they never do arithmetic on floats for persistence.
 */

export function formatMoney(amount: string | number | null | undefined, currency = "LKR"): string {
  if (amount === null || amount === undefined || amount === "") return `${currency} 0.00`;
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return `${currency} 0.00`;
  try {
    return new Intl.NumberFormat("en-LK", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatNumber(value: string | number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || value === "") return "0";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "0";
  return new Intl.NumberFormat("en-LK", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(num);
}

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? parseISO(value) : value;
  return isValid(date) ? date : null;
}

export function formatDate(value: string | Date | null | undefined, pattern = "dd MMM yyyy"): string {
  const date = toDate(value);
  return date ? format(date, pattern) : "-";
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDate(value, "dd MMM yyyy, HH:mm");
}

export function formatRelative(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? formatDistanceToNow(date, { addSuffix: true }) : "-";
}

export function isOverdue(value: string | Date | null | undefined): boolean {
  const date = toDate(value);
  return date ? date.getTime() < Date.now() : false;
}

/** Converts a Date to the `yyyy-MM-dd` value an <input type="date"> expects. */
export function toDateInput(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, "yyyy-MM-dd") : "";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/** "AN_IN_PROGRESS" -> "An In Progress" (used only as a last-resort label). */
export function humanize(value: string | null | undefined): string {
  if (!value) return "-";
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function initials(firstName?: string | null, lastName?: string | null): string {
  const a = (firstName ?? "").trim().charAt(0);
  const b = (lastName ?? "").trim().charAt(0);
  return `${a}${b}`.toUpperCase() || "?";
}

export function clientDisplayName(client?: { companyName?: string | null; firstName?: string; lastName?: string } | null): string {
  if (!client) return "-";
  if (client.companyName) return client.companyName;
  return `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim() || "-";
}
