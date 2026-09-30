import type { User } from '../types/api';
import { ApiError, apiFetch } from './client';

export const GOOGLE_LOGIN_URL = '/api/auth/google';

/** The signed-in user, or null when there is no valid session. */
export async function getMe(): Promise<User | null> {
  try {
    return await apiFetch<User>('/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const logout = () => apiFetch<void>('/auth/logout', { method: 'POST' });
