import { config } from '../../config';
import { elastic } from '../../lib/elastic';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';

/**
 * Elasticsearch is only a search index. Postgres stays the source of truth: every write here is best effort,
 * and search results are re-read from Postgres, so a lagging or missing index never shows wrong statuses.
 */

// Elasticsearch's default result window. Postgres paginates the ids, so every match up to this is reachable.
const MAX_SEARCH_HITS = 10_000;

let indexReady: Promise<void> | undefined;

// Created explicitly so ES never guesses the mapping from the first document.
export function ensureEmailIndex(): Promise<void> {
  indexReady ??= (async () => {
    if (await elastic.indices.exists({ index: config.esIndex })) return;
    await elastic.indices
      .create({
        index: config.esIndex,
        mappings: {
          dynamic: 'strict',
          properties: {
            userId: { type: 'keyword' },
            campaignId: { type: 'keyword' },
            toEmail: { type: 'keyword' },
            senderEmail: { type: 'keyword' },
            subject: { type: 'search_as_you_type', fields: { keyword: { type: 'keyword', ignore_above: 512 } } },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
          },
        },
      })
      .catch((err) => {
        if (err?.meta?.body?.error?.type !== 'resource_already_exists_exception') throw err;
      });
  })().catch((err) => {
    indexReady = undefined;
    throw err;
  });
  return indexReady;
}

type EmailRow = Awaited<ReturnType<typeof loadEmails>>[number];

function loadEmails(ids: string[]) {
  return prisma.email.findMany({ where: { id: { in: ids } }, include: { sender: { select: { email: true } } } });
}

function toDoc(e: EmailRow) {
  return {
    userId: e.userId,
    campaignId: e.campaignId,
    toEmail: e.toEmail,
    senderEmail: e.sender.email,
    subject: e.subject,
    status: e.status,
    scheduledAt: e.scheduledAt,
    sentAt: e.sentAt,
  };
}

/**
 * Re-indexes the emails from their current Postgres state. The document version is the row's updatedAt,
 * so if two updates race, an older state can never overwrite a newer one.
 */
export async function syncEmailsToSearch(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await ensureEmailIndex();
    for (let i = 0; i < ids.length; i += 1000) {
      const emails = await loadEmails(ids.slice(i, i + 1000));
      const res = await elastic.bulk({
        operations: emails.flatMap((e) => [
          { index: { _index: config.esIndex, _id: e.id, version: e.updatedAt.getTime(), version_type: 'external' } },
          toDoc(e),
        ]),
      });
      const failed = res.items.filter((item) => item.index?.error && item.index.status !== 409);
      if (failed.length) logger.warn({ failed: failed.length, first: failed[0].index?.error }, 'Search index update partly failed');
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, count: ids.length }, 'Search index update failed (sending is unaffected)');
  }
}

export function syncEmailToSearch(id: string): void {
  void syncEmailsToSearch([id]);
}

/**
 * Returns ids of this user's emails whose subject or address matches `q` (case-insensitive, partial).
 * Every word must match. A query with "@" is an address search and only looks at the recipient.
 */
export async function searchEmailIds(userId: string, q: string): Promise<string[]> {
  await ensureEmailIndex();
  const pattern = `*${q.toLowerCase().replace(/[*?\\]/g, '\\$&')}*`;
  const address = { wildcard: { toEmail: { value: pattern, case_insensitive: true } } };
  const subject = [
    {
      multi_match: {
        query: q,
        type: 'bool_prefix' as const,
        operator: 'and' as const,
        fields: ['subject', 'subject._2gram', 'subject._3gram'],
      },
    },
    { wildcard: { 'subject.keyword': { value: pattern, case_insensitive: true } } },
  ];
  const res = await elastic.search({
    index: config.esIndex,
    size: MAX_SEARCH_HITS,
    _source: false,
    query: {
      bool: {
        filter: [{ term: { userId } }],
        minimum_should_match: 1,
        should: q.includes('@') ? [address] : [address, ...subject],
      },
    },
  });
  return res.hits.hits.map((hit) => hit._id!);
}
