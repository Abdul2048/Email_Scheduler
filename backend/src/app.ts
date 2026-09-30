import cookieParser from 'cookie-parser';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger';
import { errorHandler, notFound } from './middleware/errorHandler';
import { requireAuth } from './middleware/requireAuth';
import { authRouter } from './modules/auth/auth.routes';
import { campaignRouter } from './modules/campaigns/campaign.routes';
import { emailRouter } from './modules/emails/email.routes';
import { slackRouter } from './modules/slack/slack.routes';
import { BULL_BOARD_PATH, createBullBoardRouter } from './queue/bullBoard';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' || !!req.url?.startsWith(BULL_BOARD_PATH) },
    }),
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/campaigns', requireAuth, campaignRouter);
  app.use('/api/emails', requireAuth, emailRouter);
  app.use('/api/integrations/slack', requireAuth, slackRouter);
  app.use(BULL_BOARD_PATH, requireAuth, createBullBoardRouter());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
