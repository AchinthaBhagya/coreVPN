import { ApiError } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

/** Extracts a human-readable message from any thrown value. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

/** Shows a destructive toast for an API/unknown error. */
export function toastError(error: unknown, fallback?: string): void {
  toast({ variant: "destructive", title: "Something went wrong", description: errorMessage(error, fallback) });
}

export function toastSuccess(title: string, description?: string): void {
  toast({ title, description });
}

export function toastInfo(title: string, description?: string): void {
  toast({ title, description });
}

/** Field-level errors from a 422/400 response, for react-hook-form. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (error instanceof ApiError) return error.fieldErrors();
  return {};
}
