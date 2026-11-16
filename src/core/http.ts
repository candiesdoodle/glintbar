/**
 * HTTP through Rust (no CORS, Windows certificate store, secrets substituted server-side).
 * Errors are normalised to `HttpError` with a plain-language `message` you can show as-is.
 */
import { BackendError, call } from "./backend";

export interface HttpRequest {
  method?: string;
  headers?: Record<string, string>;
  /** A string is sent as-is; an object is sent as JSON. */
  body?: string | object;
  query?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export type HttpErrorKind =
  | "offline"
  | "timeout"
  | "not_connected"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "server"
  | "bad_response"
  | "unknown";

const MESSAGES: Record<HttpErrorKind, string> = {
  offline: "The service couldn't be reached. This PC may be offline.",
  timeout: "The service didn't reply in time.",
  not_connected: "Not connected. Add a key to see your own numbers.",
  unauthorized: "The service rejected this key. Make sure it was copied in full, or make a fresh one.",
  forbidden: "Read access is not allowed for this key. Grant it, then retry.",
  not_found: "The service found nothing for that account or ID. Make sure it is correct.",
  rate_limited: "Too many requests for now. The tile retries on its own shortly.",
  server: "The service returned an error on its side.",
  bad_response: "The service's reply couldn't be read.",
  unknown: "An unexpected error occurred.",
};

/**
 * Replaces every URL in `text` with just its host. Error texts from the network layer quote the
 * request URL, which can hold a secret (a private iCal address, a key in the query string).
 */
export function redactUrls(text: string): string {
  return text.replace(/\b(?:https?|webcals?|wss?):\/\/[^\s"'<>)\]]+/gi, (url) => {
    const m = /^[a-z]+:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url);
    return m ? m[1] : "a web address";
  });
}

export class HttpError extends Error {
  readonly kind: HttpErrorKind;
  readonly status?: number;
  /** Extra text for logs and vendor messages; URLs in it are cut down to their host. */
  readonly detail?: string;
  constructor(kind: HttpErrorKind, status?: number, detail?: string) {
    super(MESSAGES[kind]);
    this.name = "HttpError";
    this.kind = kind;
    this.status = status;
    this.detail = detail === undefined ? undefined : redactUrls(detail);
  }
}

export function kindForStatus(status: number): HttpErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_response";
}

export function withQuery(url: string, query?: HttpRequest["query"]): string {
  if (!query) return url;
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  if (!parts.length) return url;
  return url + (url.includes("?") ? "&" : "?") + parts.join("&");
}

/** Never throws for HTTP status codes; throws HttpError for network/connection problems. */
export async function httpRaw(url: string, req: HttpRequest = {}): Promise<HttpResponse> {
  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  let body: string | undefined;
  if (typeof req.body === "string") body = req.body;
  else if (req.body !== undefined) {
    body = JSON.stringify(req.body);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json";
  }
  try {
    return await call<HttpResponse>("http", "fetch", {
      url: withQuery(url, req.query),
      method: req.method ?? (body !== undefined ? "POST" : "GET"),
      headers,
      body,
      timeoutMs: req.timeoutMs,
    });
  } catch (e) {
    throw toHttpError(e);
  }
}

export function toHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof BackendError) {
    if (e.code === "offline") return new HttpError("offline", undefined, e.message);
    if (e.code === "timeout") return new HttpError("timeout", undefined, e.message);
    if (e.code === "missing_secret") return new HttpError("not_connected", undefined, e.message);
    return new HttpError("unknown", undefined, e.message);
  }
  return new HttpError("unknown", undefined, String(e));
}

/** Body as text; non-2xx becomes an HttpError. */
export async function httpText(url: string, req: HttpRequest = {}): Promise<string> {
  const res = await httpRaw(url, req);
  if (!res.ok) throw new HttpError(kindForStatus(res.status), res.status, res.body.slice(0, 300));
  return res.body;
}

/** Body parsed as JSON; non-2xx or invalid JSON becomes an HttpError. */
export async function httpJson<T>(url: string, req: HttpRequest = {}): Promise<T> {
  const text = await httpText(url, { ...req, headers: { Accept: "application/json", ...(req.headers ?? {}) } });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError("bad_response", 200, text.slice(0, 300));
  }
}

/** A message to show for any error thrown by the helpers above (or anything else). */
export function describeError(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof BackendError) return toHttpError(e).message;
  return MESSAGES.unknown;
}
