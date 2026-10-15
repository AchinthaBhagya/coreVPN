import { describe, expect, it } from "vitest";
import { currencyValue, passwordPolicy, passwordSchema } from "@/lib/validation";

// The client mirror must match `backend/src/utils/password.ts`:
// min 10 chars + uppercase + lowercase + digit + symbol.
describe("passwordPolicy", () => {
  it("mirrors the backend policy constants", () => {
    expect(passwordPolicy.minLength).toBe(10);
    expect(passwordPolicy.summary).toMatch(/10/);
    expect(passwordPolicy.summary.length).toBeGreaterThan(0);
  });
});

describe("passwordSchema", () => {
  it("accepts a password meeting every rule", () => {
    expect(passwordSchema.safeParse("Abcdef1234!").success).toBe(true);
  });

  it("rejects passwords shorter than 10 characters", () => {
    const result = passwordSchema.safeParse("Abcdef12!");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/at least 10 characters/i);
    }
  });

  it("requires an uppercase letter", () => {
    const result = passwordSchema.safeParse("abcdef1234!");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toMatch(/uppercase/i);
  });

  it("requires a lowercase letter", () => {
    const result = passwordSchema.safeParse("ABCDEF1234!");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toMatch(/lowercase/i);
  });

  it("requires a number", () => {
    const result = passwordSchema.safeParse("Abcdefghij!");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toMatch(/number/i);
  });

  it("requires a symbol", () => {
    const result = passwordSchema.safeParse("Abcdefghij1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toMatch(/symbol/i);
  });

  it("always produces a non-empty error message for invalid input", () => {
    const result = passwordSchema.safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) {
      for (const issue of result.error.issues) {
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("currencyValue", () => {
  it("trims and upper-cases a valid code", () => {
    const result = currencyValue.safeParse(" usd ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("USD");
  });

  it("accepts already-valid codes", () => {
    expect(currencyValue.safeParse("LKR")).toEqual({ success: true, data: "LKR" });
  });

  it("rejects codes that are not 3 letters with a non-empty message", () => {
    for (const bad of ["US", "USDD", ""]) {
      const result = currencyValue.safeParse(bad);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].message.length).toBeGreaterThan(0);
    }
  });
});
