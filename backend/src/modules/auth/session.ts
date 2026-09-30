import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

export const SESSION_COOKIE = 'session';
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

// The browser only talks to the HTTPS Vite origin (which proxies /api), so Secure cookies work in dev.
export const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

export function setSession(res: Response, userId: string): void {
  const token = jwt.sign({ sub: userId }, config.sessionSecret, { expiresIn: SESSION_TTL_SEC });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_SEC * 1000 });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}

export function readSession(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const payload = jwt.verify(token, config.sessionSecret);
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}
