import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { emailQueue } from './emailQueue';

export const BULL_BOARD_PATH = '/admin/queues';

export function createBullBoardRouter() {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
  return serverAdapter.getRouter();
}
