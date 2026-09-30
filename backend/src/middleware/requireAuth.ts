import type { RequestHandler } from 'express';
import { HttpError } from '../lib/httpError';
import { readSession, SESSION_COOKIE } from '../modules/auth/session';

export const requireAuth: RequestHandler = (req, res, next) => {
  const userId = readSession(req.cookies?.[SESSION_COOKIE]);
  if (!userId) {
    next(new HttpError(401, 'Not authenticated'));
    return;
  }
  res.locals.userId = userId;
  next();
};

export function currentUserId(locals: Record<string, unknown>): string {
  return locals.userId as string;
}
