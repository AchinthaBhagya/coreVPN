/**
 * Typed fetch client for the 3xCodz API.
 *
 * - Sends the HTTP-only session cookie (`sid`) on every request.
 * - Echoes the readable `csrf` cookie back as `X-CSRF-Token` for state changes.
 * - Unwraps the consistent `{ success, data, message, meta, errors }` envelope.
 * - Normalises failures into `ApiError` so React Query / forms can surface them.
 */

const API_BASE = "/api";

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ApiFieldError {
  field?: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  errors: ApiFieldError[];
  code?: string;

  constructor(message: string, status: number, errors: ApiFieldError[] = [], code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    this.code = code;
  }

  /** Field-keyed map for react-hook-form's `setError`. */
  fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const err of this.errors) {
      if (err.field) map[err.field] = err.message;
    }
    return map;
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

let csrfBootstrap: Promise<void> | null = null;

/** Ensures a CSRF cookie exists before a state-changing request is sent. */
async function ensureCsrfCookie(): Promise<void> {
  if (readCookie("csrf")) return;
  if (!csrfBootstrap) {
    csrfBootstrap = fetch(`${API_BASE}/auth/csrf`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then(() => undefined)
      .finally(() => {
        csrfBootstrap = null;
      });
  }
  await csrfBootstrap;
}

/** Fired when the server reports the session is gone, so the app can redirect. */
export const AUTH_EXPIRED_EVENT = "auth:expired";

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
  /** Set for multipart uploads - the Content-Type header is then left to the browser. */
  formData?: FormData;
  /** Skip the global 401 -> logout event (used by the bootstrap `/auth/me` probe). */
  silent401?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.pathname + url.search;
}

interface RawEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  meta?: { pagination?: PaginationMeta } & Record<string, unknown>;
  errors?: ApiFieldError[];
  code?: string;
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `Request failed with status ${response.status}`;
  let errors: ApiFieldError[] = [];
  let code: string | undefined;
  try {
    const body = (await response.json()) as RawEnvelope<unknown> & { message?: string; error?: string };
    message = body.message || body.error || message;
    if (Array.isArray(body.errors)) errors = body.errors;
    code = body.code;
  } catch {
    /* non-JSON error body - keep the default message */
  }
  return new ApiError(message, response.status, errors, code);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const isStateChanging = !["GET", "HEAD", "OPTIONS"].includes(method);

  if (isStateChanging) await ensureCsrfCookie();

  const headers: Record<string, string> = { Accept: "application/json" };
  const csrf = readCookie("csrf");
  if (isStateChanging && csrf) headers["X-CSRF-Token"] = csrf;

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      credentials: "include",
      headers,
      body,
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("Unable to reach the server. Check your connection and try again.", 0);
  }

  if (response.status === 401) {
    if (!options.silent401) window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    throw await parseError(response);
  }

  if (!response.ok) throw await parseError(response);

  if (response.status === 204) return undefined as T;

  const payload = (await response.json()) as RawEnvelope<T>;
  return payload.data as T;
}

/** Like `request`, but also returns the pagination envelope. */
async function requestWithMeta<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; pagination: PaginationMeta | null }> {
  const method = options.method ?? "GET";
  const isStateChanging = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (isStateChanging) await ensureCsrfCookie();

  const headers: Record<string, string> = { Accept: "application/json" };
  const csrf = readCookie("csrf");
  if (isStateChanging && csrf) headers["X-CSRF-Token"] = csrf;

  let body: BodyInit | undefined;
  if (options.formData) body = options.formData;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(buildUrl(path, options.query), {
    method,
    credentials: "include",
    headers,
    body,
    signal: options.signal,
  });

  if (response.status === 401) {
    if (!options.silent401) window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    throw await parseError(response);
  }
  if (!response.ok) throw await parseError(response);

  const payload = (await response.json()) as RawEnvelope<T>;
  return { data: payload.data as T, pagination: payload.meta?.pagination ?? null };
}

/** Downloads a binary response (PDF export) as a Blob. */
async function requestBlob(path: string, query?: RequestOptions["query"]): Promise<Blob> {
  const response = await fetch(buildUrl(path, query), {
    method: "GET",
    credentials: "include",
    headers: { Accept: "*/*" },
  });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    throw await parseError(response);
  }
  if (!response.ok) throw await parseError(response);
  return response.blob();
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) =>
    request<T>(path, { method: "GET", query, signal }),
  getWithMeta: <T>(path: string, query?: RequestOptions["query"]) =>
    requestWithMeta<T>(path, { method: "GET", query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", formData }),
  blob: requestBlob,
};

/** Triggers a browser download for a Blob, using a filename from the server when present. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
