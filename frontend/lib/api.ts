export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "message" in body) {
        const raw = (body as { message: unknown }).message;
        message = Array.isArray(raw) ? raw.join(", ") : String(raw);
      }
    } catch {
      // non-JSON error body — keep the status text fallback
    }
    throw new ApiError(response.status, message);
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

export function apiFileUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
