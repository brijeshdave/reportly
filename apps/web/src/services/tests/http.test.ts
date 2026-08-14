// Author: Brijesh Dave <https://github.com/brijeshdave>
// Two error shapes reach this client: our envelope, and better-auth's flat
// `{code, message}` from /auth/*. Both must surface a usable message.
import { afterEach, beforeEach, expect, describe, it, vi } from "vitest";

import { ApiError, http, setActiveCompanyId } from "@/services/http.js";

function respondWith(body: unknown, status = 400, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The RequestInit the client passed to `fetch` on its only call. */
function initOf(fetchMock: ReturnType<typeof respondWith>): RequestInit {
  const init = fetchMock.mock.calls[0]?.[1];
  if (!init) throw new Error("fetch was called without a RequestInit");
  return init;
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("error normalization", () => {
  it("reads our shared error envelope", async () => {
    respondWith({ error: { code: "FORBIDDEN", message: "Nope" } }, 403);
    await expect(http.get("/x")).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Nope",
    });
  });

  it("adapts better-auth's flat error body", async () => {
    respondWith({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401);
    await expect(http.post("/auth/sign-in/email")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid email or password",
    });
  });

  it("falls back when the body is not json", async () => {
    respondWith("<html>502</html>", 502);
    const error = await http.get("/x").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("Request failed (502)");
  });

  it("falls back when the json body has no message", async () => {
    respondWith({ unexpected: true }, 500);
    await expect(http.get("/x")).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("prefers the request id the server logged under", async () => {
    respondWith({ message: "boom" }, 400, { "x-request-id": "server-side-id" });
    await expect(http.get("/x")).rejects.toMatchObject({ requestId: "server-side-id" });
  });
});

describe("request headers", () => {
  it("sends credentials and a request id, and omits the company header when unset", async () => {
    const fetchMock = respondWith({ ok: true }, 200);
    await http.get("/x");

    const init = initOf(fetchMock);
    const headers = init.headers as Record<string, string>;
    expect(init.credentials).toBe("include");
    expect(headers["x-request-id"]).toMatch(/.+/);
    expect(headers).not.toHaveProperty("X-Company-Id");
  });

  it("sends the active company when one is selected", async () => {
    setActiveCompanyId("company-1");
    const fetchMock = respondWith({ ok: true }, 200);
    await http.get("/x");

    const headers = initOf(fetchMock).headers as Record<string, string>;
    expect(headers["X-Company-Id"]).toBe("company-1");
  });
});
