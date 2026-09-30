import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { HttpError } from '../../lib/httpError';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { currentUserId } from '../../middleware/requireAuth';
import { cookieOptions } from '../auth/session';
import { postToSlack, saveSlackIntegration } from './slack.service';

const STATE_COOKIE = 'slack_oauth_state';
const redirectUri = `${config.appUrl}/api/integrations/slack/callback`;

const oauthAccessSchema = z.object({
  ok: z.literal(true),
  team: z.object({ name: z.string() }),
  incoming_webhook: z.object({ url: z.url(), channel: z.string() }),
});

function slackApp() {
  if (!config.slack) throw new HttpError(503, 'Slack is not configured (set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET)');
  return config.slack;
}

export const slackRouter = Router();

slackRouter.get('/', async (_req, res) => {
  const integration = await prisma.slackIntegration.findUnique({ where: { userId: currentUserId(res.locals) } });
  res.json({
    configured: !!config.slack,
    connected: !!integration,
    teamName: integration?.teamName ?? null,
    channelName: integration?.channelName ?? null,
  });
});

slackRouter.get('/connect', (_req, res) => {
  const { clientId } = slackApp();
  const state = randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, { ...cookieOptions, maxAge: 10 * 60 * 1000 });
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.search = new URLSearchParams({ client_id: clientId, scope: 'incoming-webhook', redirect_uri: redirectUri, state }).toString();
  res.redirect(url.toString());
});

slackRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const expectedState = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, cookieOptions);
  const done = (result: string) => res.redirect(`${config.appUrl}/dashboard?slack=${encodeURIComponent(result)}`);

  if (error) return done(error === 'access_denied' ? 'cancelled' : 'error');
  if (!code || !state || state !== expectedState) return done('invalid_state');

  try {
    const { clientId, clientSecret } = slackApp();
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    const parsed = oauthAccessSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ slackError: (body as { error?: string }).error }, 'Slack OAuth exchange failed');
      return done('error');
    }

    const userId = currentUserId(res.locals);
    const data = {
      webhookUrl: parsed.data.incoming_webhook.url,
      teamName: parsed.data.team.name,
      channelName: parsed.data.incoming_webhook.channel,
    };
    await saveSlackIntegration(userId, data);
    logger.info({ userId, team: data.teamName, channel: data.channelName }, 'Slack connected');
    done('connected');
  } catch (err) {
    logger.error({ err }, 'Slack OAuth callback failed');
    done('error');
  }
});

slackRouter.post('/test', async (_req, res) => {
  const integration = await prisma.slackIntegration.findUnique({ where: { userId: currentUserId(res.locals) } });
  if (!integration) throw new HttpError(400, 'Slack is not connected');
  await postToSlack(integration.webhookUrl, ':white_check_mark: ReachInbox scheduler is connected to this channel.').catch((err) => {
    throw new HttpError(502, `Slack rejected the message: ${(err as Error).message}`);
  });
  res.status(204).end();
});

slackRouter.delete('/', async (_req, res) => {
  await prisma.slackIntegration.deleteMany({ where: { userId: currentUserId(res.locals) } });
  res.status(204).end();
});
