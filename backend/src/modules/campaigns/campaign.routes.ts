import { Router } from 'express';
import { z } from 'zod';
import { currentUserId } from '../../middleware/requireAuth';
import { createCampaign } from './campaign.service';

const MAX_LEADS = 10_000;
const START_GRACE_MS = 60_000;

const createSchema = z.object({
  subject: z.string().trim().min(1).max(998),
  body: z.string().trim().min(1).max(100_000),
  leads: z.array(z.string()).min(1).max(MAX_LEADS),
  startAt: z.coerce
    .date()
    .refine((d) => d.getTime() >= Date.now() - START_GRACE_MS, 'startAt must not be in the past'),
  delayBetweenEmailsSec: z.number().min(0).max(3600),
  hourlyLimit: z.number().int().min(1).max(100_000),
});

export const campaignRouter = Router();

campaignRouter.post('/', async (req, res) => {
  const input = createSchema.parse(req.body);
  const result = await createCampaign(currentUserId(res.locals), input);
  res.status(201).json(result);
});
