// Author: Brijesh Dave <https://github.com/brijeshdave>
// The single HTTP entry point to the Reportly API. Every service module goes
// through here; components never call `fetch` directly. Attaches credentials,
// the active company, and a request id so one id traces browser -> API -> jobs.
import { PAGE_SIZE_OPTIONS, type ErrorEnvelope } from "@reportly/shared";

import { deviceHeaderValue } from "@/lib/device-info.js";

/** Where the API lives, relative to this origin. Exported because an <img>
 *  or a link needs the URL itself rather than a fetch through this client. */
export const API_BASE = "/api/v1";

/**
 * The page size a "load everything for a picker" fetch may ask for. The API only
 * accepts the sizes its own table pickers offer, so asking for more is a 400 and an
 * empty dropdown; taking the largest it allows keeps the two in step.
 */
export const PICKER_PAGE_SIZE = PAGE_SIZE_OPTIONS[PAGE_SIZE_OPTIONS.length - 1];
const COMPANY_STORAGE_KEY = "reportly.companyId";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId: string | null;

  constructor(status: number, envelope: ErrorEnvelope, requestId: string | null) {
    super(envelope.error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = envelope.error.code;
    this.details = envelope.error.details;
    this.requestId = requestId;
  }
}

export function getActiveCompanyId(): string | null {
  try {
    return window.localStorage.getItem(COMPANY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setActiveCompanyId(companyId: string | null): void {
  try {
    if (companyId) window.localStorage.setItem(COMPANY_STORAGE_KEY, companyId);
    else window.localStorage.removeItem(COMPANY_STORAGE_KEY);
  } catch {
    // storage unavailable — the header is simply omitted
  }
}

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  /** Serialized as JSON, unless it is `FormData` — see `isRawBody`. */
  body?: unknown;
  /** Appended as a query string; `undefined` values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * Bodies that go out untouched.
 *
 * `FormData` must not be stringified, and must not be given a Content-Type by us:
 * the browser sets `multipart/form-data` *with the boundary it generated*, and a
 * hand-written header would omit that boundary and leave the server unable to parse
 * the body it was just handed.
 */
function isRawBody(body: unknown): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Normalize an error body into the shared envelope. Our routes already return it,
 * but better-auth owns /auth/* and answers with a flat `{ code, message }`, so a
 * naive `body.error.code` would throw while handling the error.
 */
function toErrorEnvelope(body: unknown, status: number): ErrorEnvelope {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
    return body as unknown as ErrorEnvelope;
  }
  if (isRecord(body) && typeof body.message === "string") {
    return {
      error: {
        code: typeof body.code === "string" ? body.code : "INTERNAL_ERROR",
        message: body.message,
      },
    };
  }
  return { error: { code: "INTERNAL_ERROR", message: `Request failed (${status})` } };
}

/** Issues the request and throws `ApiError` on a non-2xx, whatever the body type. */
async function send(path: string, options: RequestOptions): Promise<Response> {
  const { body, query, headers, ...init } = options;
  const requestId = newRequestId();
  const companyId = getActiveCompanyId();
  // Collected once and cached; lets the server attach the device to security and
  // audit events without a separate round trip.
  const deviceInfo = deviceHeaderValue();

  const raw = isRawBody(body);

  const response = await fetch(buildUrl(path, query), {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      "x-request-id": requestId,
      ...(deviceInfo ? { "X-Device-Info": deviceInfo } : {}),
      ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}),
      ...(companyId ? { "X-Company-Id": companyId } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? (body as FormData) : JSON.stringify(body),
  });

  if (!response.ok) {
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      // non-JSON error body — the fallback envelope describes the status only
    }
    // The response header wins; it is the id the server actually logged under.
    const loggedId = response.headers.get("x-request-id") ?? requestId;
    throw new ApiError(response.status, toErrorEnvelope(errorBody, response.status), loggedId);
  }

  return response;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Streams an export to a file. The API sends these as a batched stream, so the
 * body is read as a blob rather than parsed — a big export must not be held in
 * memory as a parsed object graph.
 */
export async function download(
  path: string,
  filename: string,
  options: RequestOptions = {},
): Promise<void> {
  const response = await send(path, { ...options, method: "GET" });
  await saveBlob(response, filename);
}

/**
 * Like `download`, but for exports whose parameters are too rich for a query string
 * — a report definition (filters, columns, grouping) goes in a POST body, and the
 * response file is saved the same way.
 */
export async function downloadPost(
  path: string,
  filename: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<void> {
  const response = await send(path, { ...options, method: "POST", body });
  await saveBlob(response, filename);
}

async function saveBlob(response: Response, filename: string): Promise<void> {
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    // Revoking immediately is safe: the click has already queued the download.
    URL.revokeObjectURL(url);
  }
}

export const http = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  /** POSTs a multipart body (a file). The browser owns the content-type here. */
  postForm: <T>(path: string, form: FormData, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body: form }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
};
