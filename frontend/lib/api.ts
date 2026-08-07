export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  status: number;
  /** Parsed JSON error body, when the response had one — for endpoints that
   *  attach extra fields (e.g. an existing record's id) beyond `message`. */
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "ApiError";
  }
}

/**
 * Thin fetch wrapper shared by every page: prefixes the API base URL,
 * attaches the stored JWT (if any — public endpoints just ignore it), and
 * throws an ApiError with the backend's parsed `{ message }` body on any
 * non-2xx response (matches NestJS's default exception filter shape).
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem("token");
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = response.statusText || `Request failed (${response.status})`;
    let body: unknown;
    try {
      body = await response.json();
      if (body && typeof body === "object" && "message" in body) {
        const raw = (body as { message: unknown }).message;
        message = Array.isArray(raw) ? raw.join(", ") : String(raw);
      }
    } catch {
      // non-JSON error body — keep the status text fallback
    }
    throw new ApiError(response.status, message, body);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function patchJson<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Authenticated multipart upload. No Content-Type header is set — the
 * browser derives the multipart boundary from the FormData itself, and
 * setting one manually would strip that boundary and break parsing.
 */
export function postForm<T>(path: string, form: FormData): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: form });
}

/**
 * Like postForm, but hands back the raw Response instead of parsing the
 * whole body as JSON — for endpoints that stream newline-delimited JSON
 * (the assistant's live tool-progress feed). A non-2xx response is still a
 * single ordinary JSON error body (the stream only starts once the request
 * is accepted), so that case is parsed and thrown exactly like apiFetch.
 */
export async function postFormStream(
  path: string,
  form: FormData,
): Promise<Response> {
  const headers = new Headers();
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem("token");
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: form,
  });

  if (!response.ok) {
    let message = response.statusText || `Request failed (${response.status})`;
    let body: unknown;
    try {
      body = await response.json();
      if (body && typeof body === "object" && "message" in body) {
        const raw = (body as { message: unknown }).message;
        message = Array.isArray(raw) ? raw.join(", ") : String(raw);
      }
    } catch {
      // non-JSON error body — keep the status text fallback
    }
    throw new ApiError(response.status, message, body);
  }

  return response;
}

export function deleteRequest<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

export function apiFileUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

/**
 * apiFileUrl (plain URL concat) can't carry the stored JWT, so it only
 * works for genuinely public files (interview question audio). Staff
 * downloads (CVs) are behind JwtAuthGuard — fetch the bytes with the auth
 * header attached, then trigger a normal browser save via an object URL.
 */
export async function downloadFile(
  path: string,
  filename: string,
): Promise<void> {
  const headers = new Headers();
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem("token");
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!response.ok) {
    throw new ApiError(response.status, `Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
