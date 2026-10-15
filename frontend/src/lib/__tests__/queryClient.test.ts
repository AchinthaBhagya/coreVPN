import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

type RetryFn = (failureCount: number, error: unknown) => boolean;

describe("queryClient default options", () => {
  it("uses sensible query defaults", () => {
    const queries = queryClient.getDefaultOptions().queries as Record<string, unknown>;
    expect(queries.staleTime).toBe(60_000);
    expect(queries.gcTime).toBe(5 * 60_000);
    expect(queries.refetchOnWindowFocus).toBe(false);
  });

  it("does not retry mutations", () => {
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });

  it("retries transient failures once but not client errors", () => {
    const retry = queryClient.getDefaultOptions().queries?.retry as RetryFn;

    // A non-ApiError failure: retried on the first failure, not the second.
    expect(retry(0, new Error("network"))).toBe(true);
    expect(retry(1, new Error("network"))).toBe(false);

    // 4xx ApiErrors are never retried.
    expect(retry(0, new ApiError("bad", 400))).toBe(false);
    expect(retry(0, new ApiError("unauthorized", 401))).toBe(false);

    // 5xx ApiErrors are still transient -> retried once.
    expect(retry(0, new ApiError("boom", 500))).toBe(true);
    expect(retry(1, new ApiError("boom", 500))).toBe(false);
  });
});
