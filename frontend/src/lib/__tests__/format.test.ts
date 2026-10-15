import { describe, expect, it, vi } from "vitest";
import {
  clientDisplayName,
  formatBytes,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatRelative,
  humanize,
  initials,
  isOverdue,
  toDateInput,
  toNumber,
} from "@/lib/format";

describe("formatMoney", () => {
  it("formats LKR by default with 2 decimals", () => {
    expect(formatMoney("1234.56")).toContain("1,234.56");
  });

  it("formats another currency (USD)", () => {
    expect(formatMoney("10", "USD")).toContain("10.00");
  });

  it("handles decimal strings without float drift", () => {
    expect(formatMoney("1234.56")).toContain("1,234.56");
    expect(formatMoney("0.00")).toContain("0.00");
  });

  it("handles large values", () => {
    expect(formatMoney("1000000.50")).toContain("1,000,000.50");
  });

  it("returns safe fallback for null/undefined/empty/NaN", () => {
    expect(formatMoney(null)).toMatch(/0\.00/);
    expect(formatMoney(undefined)).toMatch(/0\.00/);
    expect(formatMoney("")).toMatch(/0\.00/);
    expect(formatMoney("not-a-number")).toMatch(/0\.00/);
  });
});

describe("formatNumber", () => {
  it("formats numbers with decimals", () => {
    expect(formatNumber(1234.5, 1)).toContain("1,234.5");
    expect(formatNumber("0", 2)).toBe("0.00");
  });

  it("handles edge cases safely", () => {
    expect(formatNumber(null)).toBe("0");
    expect(formatNumber(undefined)).toBe("0");
    expect(formatNumber("")).toBe("0");
    expect(formatNumber(NaN)).toBe("0");
  });
});

describe("toNumber", () => {
  it("converts safely", () => {
    expect(toNumber("10.5")).toBe(10.5);
    expect(toNumber("")).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("abc")).toBe(0);
  });
});

describe("formatDate/formatDateTime", () => {
  it("formats valid dates", () => {
    const d = "2025-01-15";
    expect(formatDate(d)).toMatch(/15 Jan 2025/);
    expect(formatDateTime(d)).toMatch(/15 Jan 2025/);
  });

  it("returns dash for invalid/null", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate("bad")).toBe("-");
    expect(formatDateTime(undefined)).toBe("-");
  });
});

describe("formatRelative", () => {
  it("returns a distance string relative to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
    expect(formatRelative("2025-06-13T12:00:00Z")).toMatch(/2 days ago/);
    vi.useRealTimers();
  });

  it("returns dash for falsy/invalid", () => {
    expect(formatRelative(null)).toBe("-");
    expect(formatRelative("nope")).toBe("-");
  });
});

describe("isOverdue", () => {
  it("compares dates correctly", () => {
    const past = "2000-01-01T00:00:00Z";
    expect(isOverdue(past)).toBe(true);
    const future = "2099-01-01T00:00:00Z";
    expect(isOverdue(future)).toBe(false);
    expect(isOverdue(null)).toBe(false);
  });
});

describe("toDateInput", () => {
  it("formats to yyyy-MM-dd or empty", () => {
    expect(toDateInput("2025-06-05")).toBe("2025-06-05");
    expect(toDateInput(null)).toBe("");
    expect(toDateInput("bad")).toBe("");
  });
});

describe("formatBytes", () => {
  it("formats byte units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1024)).toMatch(/1\.0 KB/);
    expect(formatBytes(1048576)).toMatch(/1\.0 MB/);
  });

  it("treats non-finite/negative as 0 B", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(NaN as unknown as number)).toBe("0 B");
    expect(formatBytes(Infinity as unknown as number)).toBe("0 B");
  });
});

describe("humanize", () => {
  it("humanizes snake/case strings", () => {
    expect(humanize("AN_IN_PROGRESS")).toBe("An In Progress");
    expect(humanize("pending_approval")).toBe("Pending Approval");
    expect(humanize(null)).toBe("-");
    expect(humanize("")).toBe("-");
  });
});

describe("initials", () => {
  it("builds initials safely", () => {
    expect(initials("John", "Doe")).toBe("JD");
    expect(initials(null, "Smith")).toBe("S");
    expect(initials("Alice", null)).toBe("A");
    expect(initials("", "")).toBe("?");
  });
});

describe("clientDisplayName", () => {
  it("prefers company name", () => {
    expect(clientDisplayName({ companyName: "Acme", firstName: "A", lastName: "B" })).toBe("Acme");
  });

  it("falls back to full name", () => {
    expect(clientDisplayName({ firstName: "Jane", lastName: "Roe" })).toBe("Jane Roe");
    expect(clientDisplayName({ firstName: "Solo", lastName: "" })).toBe("Solo");
  });

  it("returns dash for null/empty", () => {
    expect(clientDisplayName(null)).toBe("-");
    expect(clientDisplayName({} as any)).toBe("-");
  });
});
