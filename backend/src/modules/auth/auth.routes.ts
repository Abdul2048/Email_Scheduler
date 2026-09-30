import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../../config';
import { HttpError } from '../../lib/httpError';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { currentUserId, requireAuth } from '../../middleware/requireAuth';
import { clearSession, cookieOptions, setSession } from './session';

const STATE_COOKIE = 'google_oauth_state';
const redirectUri = `${config.appUrl}/api/auth/google/callback`;

function googleClient(): OAuth2Client {
  if (!config.google) {
    throw new HttpError(503, 'Google OAuth is not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)');
  }
  return new OAuth2Client(config.google.clientId, config.google.clientSecret, redirectUri);
}

export const authRouter = Router();

authRouter.get('/google', (_req, res) => {
  const client = googleClient();
  const state = randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, { ...cookieOptions, maxAge: 10 * 60 * 1000 });
  res.redirect(
    client.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, prompt: 'select_account' }),
  );
});

authRouter.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, cookieOptions);

  const fail = (reason: string) => res.redirect(`${config.appUrl}/login?error=${encodeURIComponent(reason)}`);

  if (error) return fail(error);
  if (!code || !state || state !== expectedState) return fail('invalid_state');

  try {
    const client = googleClient();
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token!, audience: config.google!.clientId });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email) return fail('missing_profile');

    const data = {
      email: profile.email,
      name: profile.name ?? profile.email,
      avatarUrl: profile.picture ?? null,
    };
    const user = await prisma.user.upsert({
      where: { googleId: profile.sub },
      create: { googleId: profile.sub, ...data },
      update: data,
    });

    setSession(res, user.id);
    res.redirect(`${config.appUrl}/dashboard`);
  } catch (err) {
    logger.error({ err }, 'Google OAuth callback failed');
    fail('oauth_failed');
  }
});

authRouter.get('/me', requireAuth, async (_req, res) => {
  const user = await prisma.user.findUnique({ where: { id: currentUserId(res.locals) } });
  if (!user) throw new HttpError(401, 'Not authenticated');
  res.json({ id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});
