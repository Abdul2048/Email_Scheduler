import type { ApiErrorBody } from '../types/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const UNREACHABLE = "Can't reach the server. Check that the backend is running.";

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  if (!res.ok) {
    // Errors from the API always have a JSON body; anything else is the dev proxy failing to reach it.
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error?.message ?? (res.status >= 500 ? UNREACHABLE : `Request failed (${res.status})`));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
