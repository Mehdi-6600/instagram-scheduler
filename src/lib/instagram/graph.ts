/** Low-level Meta Graph API client (Facebook Login and Instagram Login modes). */

import { metaGraphVersion, oauthMode } from "../env";

export type GraphMode = "facebook" | "instagram";

export function graphHost(mode: GraphMode = oauthMode()): string {
  return mode === "instagram" ? "graph.instagram.com" : "graph.facebook.com";
}

export interface MetaApiErrorBody {
  message: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
}

export class GraphApiError extends Error {
  httpStatus: number;
  code?: number;
  subcode?: number;
  type?: string;
  fbtraceId?: string;
  raw: unknown;

  constructor(body: MetaApiErrorBody | null, httpStatus: number, raw?: unknown) {
    super(body?.message || `Meta API request failed (HTTP ${httpStatus})`);
    this.name = "GraphApiError";
    this.httpStatus = httpStatus;
    this.code = body?.code;
    this.subcode = body?.error_subcode;
    this.type = body?.type;
    this.fbtraceId = body?.fbtrace_id;
    this.raw = raw;
  }
}

export class NetworkError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

/** Strip anything token-like from a response before persisting it. */
export function sanitizeForStorage(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizeForStorage);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|password|authorization/i.test(k)) continue;
      out[k] = sanitizeForStorage(v);
    }
    return out;
  }
  return value;
}

export interface GraphRequestOptions {
  path: string;
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, string | number | undefined>;
  token: string;
  mode?: GraphMode;
  timeoutMs?: number;
}

export async function graphRequest<T = unknown>(
  opts: GraphRequestOptions
): Promise<T> {
  const mode = opts.mode ?? oauthMode();
  const version = metaGraphVersion();
  const url = new URL(`https://${graphHost(mode)}/${version}${opts.path}`);
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined) params[k] = String(v);
  }

  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  };

  if ((opts.method ?? "GET") === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", opts.token);
  } else {
    // POST/DELETE as form-encoded (Graph API convention).
    const body = new URLSearchParams({ ...params, access_token: opts.token });
    init.body = body.toString();
    init.headers = {
      ...init.headers,
      "Content-Type": "application/x-www-form-urlencoded",
    };
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new NetworkError(
      err instanceof Error ? err.message : "Network request to Meta failed",
      err
    );
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body — fall through with status-based handling.
  }

  const errBody = (json as { error?: MetaApiErrorBody } | null)?.error;
  if (!res.ok || errBody) {
    throw new GraphApiError(errBody ?? null, res.status, sanitizeForStorage(json));
  }
  return json as T;
}

export interface LongLivedToken {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}
