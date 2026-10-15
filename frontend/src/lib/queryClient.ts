import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

/**
 * Shared React Query client. Sensible defaults for an internal business app:
 * data is fresh for a minute, requests are retried once (except auth failures),
 * and window focus does not spam the API.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

/** Central query-key factory so invalidation stays predictable. */
export const qk = {
  me: ["me"] as const,
  dashboard: ["dashboard"] as const,
  portal: {
    dashboard: ["portal", "dashboard"] as const,
    profile: ["portal", "profile"] as const,
    projects: ["portal", "projects"] as const,
    project: (id: string) => ["portal", "projects", id] as const,
    quotations: ["portal", "quotations"] as const,
    quotation: (id: string) => ["portal", "quotations", id] as const,
    invoices: ["portal", "invoices"] as const,
    invoice: (id: string) => ["portal", "invoices", id] as const,
    tickets: ["portal", "tickets"] as const,
    ticket: (id: string) => ["portal", "tickets", id] as const,
  },
  list: (resource: string, params?: unknown) => [resource, "list", params ?? {}] as const,
  detail: (resource: string, id?: string) => [resource, "detail", id] as const,
  notifications: {
    list: ["notifications", "list"] as const,
    unread: ["notifications", "unread"] as const,
    preferences: ["notifications", "preferences"] as const,
  },
} as const;
