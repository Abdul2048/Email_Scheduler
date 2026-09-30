// Rebuilds the Elasticsearch index from Postgres (the source of truth):  npm run es:reindex
import { config } from '../src/config';
import { elastic } from '../src/lib/elastic';
import { prisma } from '../src/lib/prisma';
import { ensureEmailIndex, syncEmailsToSearch } from '../src/modules/emails/emailSearch';

const PAGE = 1000;

async function main() {
  await elastic.indices.delete({ index: config.esIndex, ignore_unavailable: true });
  await ensureEmailIndex();

  let cursor: string | undefined;
  let total = 0;
  for (;;) {
    const page = await prisma.email.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (page.length === 0) break;
    await syncEmailsToSearch(page.map((e) => e.id));
    cursor = page[page.length - 1].id;
    total += page.length;
  }
  await elastic.indices.refresh({ index: config.esIndex });
  const { count } = await elastic.count({ index: config.esIndex });
  console.log(`Reindexed ${total} emails from Postgres; index "${config.esIndex}" now has ${count} documents`);
  if (count !== total) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().then(() => process.exit()));
