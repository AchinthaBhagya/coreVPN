import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, AUTH_EXPIRED_EVENT, api, downloadBlob } from "@/lib/api";

type AnyInit = Omit<RequestInit, "headers"> & { headers: Record<string, string> };

/** Minimal Response stand-in: api.ts only reads ok/status/json()/blob(). */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob(["x"]),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

function clearCookies() {
  document.cookie.split(";").forEach((c) => {
    const name = c.trim().split("=")[0];
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
}

beforeEach(() => {
  clearCookies();
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: {} }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearCookies();
});

describe("request envelope", () => {
  it("unwraps { success, data } and returns data", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: 7, name: "Acme" } }));
    const result = await api.get<{ id: number; name: string }>("/clients/7");
    expect(result).toEqual({ id: 7, name: "Acme" });
  });

  it("sends credentials: 'include' on GET", async () => {
    await api.get("/clients");
    const init = fetchMock.mock.calls[0][1] as AnyInit;
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("GET");
  });

  it("builds query strings and skips empty values", async () => {
    await api.get("/things", { a: 1, b: "two", skip: undefined, empty: "", zero: 0 });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/things?a=1&b=two&zero=0");
  });

  it("returns undefined for 204 No Content", async () => {
    document.cookie = "csrf=tok";
    fetchMock.mockResolvedValue(jsonResponse(undefined, 204));
    await expect(api.del("/clients/1")).resolves.toBeUndefined();
  });
});

describe("CSRF handling", () => {
  it("echoes the csrf cookie as X-CSRF-Token on state-changing requests", async () => {
    document.cookie = "csrf=tok123";
    await api.post("/clients", { name: "x" });
    const init = fetchMock.mock.calls[0][1] as AnyInit;
    expect(init.method).toBe("POST");
    expect(init.headers["X-CSRF-Token"]).toBe("tok123");
  });

  it("does not send X-CSRF-Token on GET", async () => {
    document.cookie = "csrf=tok123";
    await api.get("/clients");
    const init = fetchMock.mock.calls[0][1] as AnyInit;
    expect(init.headers["X-CSRF-Token"]).toBeUndefined();
  });

  it("bootstraps a csrf cookie when none exists", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/auth/csrf")) {
        document.cookie = "csrf=fresh-token";
        return Promise.resolve(jsonResponse({ success: true, data: null }));
      }
      return Promise.resolve(jsonResponse({ success: true, data: { ok: true } }));
    });

    await api.post("/things", { a: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/csrf");
    const actualInit = fetchMock.mock.calls[1][1] as AnyInit;
    expect(actualInit.headers["X-CSRF-Token"]).toBe("fresh-token");
  });
});

describe("bodies", () => {
  it("sends JSON bodies with a JSON content-type", async () => {
    document.cookie = "csrf=tok";
    await api.post("/things", { a: 1 });
    const init = fetchMock.mock.calls[0][1] as AnyInit;
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("sends FormData without a JSON content-type", async () => {
    document.cookie = "csrf=tok";
    const fd = new FormData();
    fd.append("file", "abc");
    await api.upload("/upload", fd);
    const init = fetchMock.mock.calls[0][1] as AnyInit;
    expect(init.body).toBe(fd);
    expect(init.headers["Content-Type"]).toBeUndefined();
  });
});

describe("error handling", () => {
  it("throws a typed ApiError with status + message for non-2xx", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "Server exploded" }, 500));
    const err = (await api.get("/boom").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.message).toBe("Server exploded");
  });

  it("carries validation errors from a 422 response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          message: "Validation failed",
          errors: [
            { field: "email", message: "Invalid email" },
            { field: "name", message: "Required" },
          ],
        },
        422,
      ),
    );
    const err = (await api.post("/clients", {}).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.message).toBe("Validation failed");
    expect(err.fieldErrors()).toEqual({ email: "Invalid email", name: "Required" });
  });

  it("surfaces 401 and dispatches the auth-expired event", async () => {
    const spy = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, spy);
    fetchMock.mockResolvedValue(jsonResponse({ message: "Unauthorized" }, 401));

    const err = (await api.get("/me").catch((e) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_EXPIRED_EVENT, spy);
  });

  it("converts network failures into a status-0 ApiError", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const err = (await api.get("/clients").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/unable to reach the server/i);
  });

  it("rethrows AbortError untouched", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    fetchMock.mockRejectedValue(abortErr);
    const err = (await api.get("/clients").catch((e) => e)) as Error;
    expect(err.name).toBe("AbortError");
    expect(err).not.toBeInstanceOf(ApiError);
  });
});

describe("downloadBlob", () => {
  const originalClick = HTMLAnchorElement.prototype.click;
  let created: HTMLAnchorElement | undefined;
  let revoked: string[];
  let objectUrlSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    created = undefined;
    revoked = [];
    objectUrlSpy = vi.fn(() => "blob:mock-url");
    const revokeSpy = vi.fn((u: string) => revoked.push(u));
    URL.createObjectURL = objectUrlSpy;
    URL.revokeObjectURL = revokeSpy;
    clickSpy = vi.fn(function (this: HTMLAnchorElement) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- the anchor is removed from the DOM right after the click, so the receiver has to be captured here.
      created = this;
    });
    HTMLAnchorElement.prototype.click = clickSpy;
  });

  afterEach(() => {
    HTMLAnchorElement.prototype.click = originalClick;
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("downloads using the supplied filename and cleans up", () => {
    const blob = new Blob(["pdf-bytes"], { type: "application/pdf" });
    downloadBlob(blob, "INV-001.pdf");

    expect(objectUrlSpy).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    if (!created) throw new Error("download click was never captured on an anchor element");
    expect(created.download).toBe("INV-001.pdf");
    expect(created.href).toBe("blob:mock-url");
    expect(revoked).toContain("blob:mock-url");
    // anchor is removed from the DOM after the click
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
