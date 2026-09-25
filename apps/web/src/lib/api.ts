// Access token lives in memory only (module-level, not localStorage) per
// docs/PLAN-PUBLIC.md §5 — it's lost on a full page reload by design, and
// AuthContext restores it via a silent /refresh call against the
// httpOnly refresh cookie instead.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`/api${path}`, {
    ...init,
    credentials: "include", // sends the httpOnly refresh cookie, same-origin
    headers: {
      // Only set for requests that actually have a body — Fastify's JSON
      // parser rejects a request that declares this content-type but
      // sends no body at all (e.g. bodyless POSTs like /refresh, /logout).
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
}

async function parseOrThrow(res: Response): Promise<unknown> {
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const errBody = body as { error?: string; message?: string } | null;
    throw new ApiError(res.status, errBody?.error ?? "unknown_error", errBody?.message ?? res.statusText);
  }
  return body;
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await rawFetch("/auth/refresh", { method: "POST" });
      if (!res.ok) return false;
      const body = (await res.json()) as { accessToken: string };
      setAccessToken(body.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Fetch wrapper that transparently retries once through a silent
 * refresh on a 401, so an expired ~15-minute access token doesn't
 * surface as a login prompt while the refresh cookie is still valid. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const first = await rawFetch(path, init);
  if (first.status !== 401) return parseOrThrow(first);

  const refreshed = await tryRefresh();
  if (!refreshed) return parseOrThrow(first);

  const second = await rawFetch(path, init);
  return parseOrThrow(second);
}

export function apiPost(path: string, body?: unknown): Promise<unknown> {
  return apiFetch(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function apiGet(path: string): Promise<unknown> {
  return apiFetch(path, { method: "GET" });
}

export function apiDelete(path: string): Promise<unknown> {
  return apiFetch(path, { method: "DELETE" });
}

export function apiPatch(path: string, body?: unknown): Promise<unknown> {
  return apiFetch(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });
}
