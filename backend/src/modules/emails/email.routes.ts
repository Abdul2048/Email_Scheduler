import type { EmailStatus, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../lib/httpError';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { currentUserId } from '../../middleware/requireAuth';
import { searchEmailIds } from './emailSearch';

const PAGE_SIZE = 20;
const PREVIEW_CHARS = 140;

const VIEWS = {
  scheduled: {
    statuses: ['SCHEDULED', 'DEFERRED', 'SENDING'] as EmailStatus[],
    orderBy: [{ scheduledAt: 'asc' }] as Prisma.EmailOrderByWithRelationInput[],
  },
  sent: {
    statuses: ['SENT', 'FAILED'] as EmailStatus[],
    orderBy: [{ updatedAt: 'desc' }] as Prisma.EmailOrderByWithRelationInput[],
  },
};

const listSchema = z.object({
  view: z.enum(['scheduled', 'sent']),
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().max(200).optional(),
});

const include = { sender: { select: { email: true } }, campaign: { select: { body: true } } } satisfies Prisma.EmailInclude;
type EmailRow = Prisma.EmailGetPayload<{ include: typeof include }>;

const toItem = (e: EmailRow) => ({
  id: e.id,
  toEmail: e.toEmail,
  subject: e.subject,
  bodyPreview: e.campaign.body.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS),
  senderEmail: e.sender.email,
  status: e.status,
  scheduledAt: e.scheduledAt,
  sentAt: e.sentAt,
  previewUrl: e.previewUrl,
  error: e.error,
});

export const emailRouter = Router();

emailRouter.get('/counts', async (_req, res) => {
  const userId = currentUserId(res.locals);
  const [scheduled, sent] = await Promise.all(
    [VIEWS.scheduled, VIEWS.sent].map(({ statuses }) => prisma.email.count({ where: { userId, status: { in: statuses } } })),
  );
  res.json({ scheduled, sent });
});

emailRouter.get('/', async (req, res) => {
  const { view, page, q } = listSchema.parse(req.query);
  const { statuses, orderBy } = VIEWS[view];
  const userId = currentUserId(res.locals);
  const where: Prisma.EmailWhereInput = { userId, status: { in: statuses } };

  // Elasticsearch finds the matches; Postgres still filters by status, sorts and paginates.
  if (q) {
    const ids = await searchEmailIds(userId, q).catch((err) => {
      logger.warn({ err: (err as Error).message }, 'Search failed');
      throw new HttpError(503, 'Search is temporarily unavailable');
    });
    where.id = { in: ids };
  }

  const [items, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include,
    }),
    prisma.email.count({ where }),
  ]);

  res.json({ items: items.map(toItem), page, pageSize: PAGE_SIZE, total });
});

emailRouter.get('/:id', async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  const email = id.success
    ? await prisma.email.findFirst({ where: { id: id.data, userId: currentUserId(res.locals) }, include })
    : null;
  if (!email) throw new HttpError(404, 'Email not found');
  res.json({ ...toItem(email), body: email.campaign.body });
});
