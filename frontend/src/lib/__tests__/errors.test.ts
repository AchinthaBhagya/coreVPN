import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/api";
import { errorMessage, fieldErrors, toastError, toastInfo, toastSuccess } from "@/lib/errors";
import { toast } from "@/hooks/use-toast";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: vi.fn(),
  reducer: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("errorMessage", () => {
  it("returns the message from an ApiError", () => {
    expect(errorMessage(new ApiError("Bad input", 400))).toBe("Bad input");
  });

  it("returns the message from a plain Error", () => {
    expect(errorMessage(new Error("kaboom"))).toBe("kaboom");
  });

  it("returns a string error as-is", () => {
    expect(errorMessage("direct message")).toBe("direct message");
  });

  it("falls back for unknown values", () => {
    expect(errorMessage({ weird: true })).toMatch(/Something went wrong/i);
    expect(errorMessage(null)).toMatch(/Something went wrong/i);
  });

  it("honours a custom fallback", () => {
    expect(errorMessage(undefined, "Custom fallback")).toBe("Custom fallback");
  });
});

describe("fieldErrors", () => {
  it("keys ApiError field errors by field", () => {
    const err = new ApiError("Invalid", 422, [
      { field: "email", message: "Invalid email" },
      { field: "name", message: "Required" },
      { message: "no field here" },
    ]);
    expect(fieldErrors(err)).toEqual({
      email: "Invalid email",
      name: "Required",
    });
  });

  it("returns empty for non-ApiError values", () => {
    expect(fieldErrors(new Error("plain"))).toEqual({});
    expect(fieldErrors("string")).toEqual({});
  });
});

describe("toast helpers", () => {
  it("toastError shows a destructive toast with the error message", () => {
    toastError(new ApiError("Nope", 403));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: "Something went wrong",
        description: "Nope",
      }),
    );
  });

  it("toastError uses the custom fallback when provided", () => {
    toastError(undefined, "Try again later");
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", description: "Try again later" }),
    );
  });

  it("toastSuccess and toastInfo show non-destructive toasts", () => {
    toastSuccess("Saved", "All good");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Saved", description: "All good" }));

    toastInfo("Heads up");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Heads up" }));
  });
});
