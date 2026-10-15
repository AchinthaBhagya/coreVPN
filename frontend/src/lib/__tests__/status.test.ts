import { describe, expect, it } from "vitest";
import { OPTIONS, statusLabel, toneForStatus, type Tone } from "@/lib/status";

const VALID_TONES = new Set<Tone>([
  "default",
  "primary",
  "success",
  "warning",
  "danger",
  "info",
  "muted",
]);

describe("toneForStatus", () => {
  it("maps representative statuses to their intended tone", () => {
    expect(toneForStatus("ACTIVE")).toBe("success");
    expect(toneForStatus("PAID")).toBe("success");
    expect(toneForStatus("COMPLETED")).toBe("success");
    expect(toneForStatus("OVERDUE")).toBe("danger");
    expect(toneForStatus("REJECTED")).toBe("danger");
    expect(toneForStatus("DRAFT")).toBe("muted");
    expect(toneForStatus("IN_PROGRESS")).toBe("primary");
    expect(toneForStatus("PENDING")).toBe("warning");
    expect(toneForStatus("NEW")).toBe("info");
  });

  it("is case-insensitive", () => {
    expect(toneForStatus("paid")).toBe("success");
    expect(toneForStatus("in_progress")).toBe("primary");
    expect(toneForStatus("In_Progress")).toBe("primary");
  });

  it("degrades gracefully for null/undefined/unknown", () => {
    expect(toneForStatus(null)).toBe("default");
    expect(toneForStatus(undefined)).toBe("default");
    expect(toneForStatus("")).toBe("default");
    expect(toneForStatus("NOT_A_REAL_STATUS")).toBe("default");
  });

  it("maps every enum option in OPTIONS to a valid tone without throwing", () => {
    const allStatuses = Object.values(OPTIONS).flatMap((list) => [...list]);
    expect(allStatuses.length).toBeGreaterThan(0);
    for (const status of allStatuses) {
      expect(VALID_TONES.has(toneForStatus(status))).toBe(true);
    }
  });
});

describe("statusLabel", () => {
  it("humanises status strings", () => {
    expect(statusLabel("IN_PROGRESS")).toBe("In Progress");
    expect(statusLabel("PAID")).toBe("Paid");
    expect(statusLabel("WAITING_CLIENT")).toBe("Waiting Client");
  });

  it("returns dash for null/undefined", () => {
    expect(statusLabel(null)).toBe("-");
    expect(statusLabel(undefined)).toBe("-");
  });

  it("produces a non-empty label for every enum option", () => {
    const allStatuses = Object.values(OPTIONS).flatMap((list) => [...list]);
    for (const status of allStatuses) {
      expect(statusLabel(status).length).toBeGreaterThan(0);
    }
  });
});
