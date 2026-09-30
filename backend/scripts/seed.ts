import { config } from '../src/config';
import { prisma } from '../src/lib/prisma';

interface EtherealAccount {
  status: string;
  user: string;
  pass: string;
  smtp: { host: string; port: number };
}

// nodemailer.createTestAccount() caches one account per process, so call Ethereal's API directly
// to get a distinct account for every sender.
async function createEtherealAccount(): Promise<EtherealAccount> {
  const res = await fetch('https://api.nodemailer.com/user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestor: 'reachinbox-scheduler', version: '1.0.0' }),
  });
  const account = (await res.json()) as EtherealAccount;
  if (!res.ok || account.status !== 'success') throw new Error(`Ethereal account creation failed (${res.status})`);
  return account;
}

async function main() {
  const existing = await prisma.sender.count();
  const missing = config.senderCount - existing;
  if (missing <= 0) {
    console.log(`Senders already seeded (${existing}).`);
    return;
  }

  for (let i = 0; i < missing; i++) {
    const account = await createEtherealAccount();
    await prisma.sender.create({
      data: {
        email: account.user,
        smtpHost: account.smtp.host,
        smtpPort: account.smtp.port,
        smtpUser: account.user,
        smtpPass: account.pass,
      },
    });
    console.log(`Created Ethereal sender ${account.user}`);
  }
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
