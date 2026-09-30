import { lookup } from 'node:dns/promises';
import type { Sender } from '@prisma/client';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config';
import { redis } from '../../lib/redis';

const transports = new Map<string, Promise<Transporter>>();

export const dryrunKeys = {
  sendCounts: () => `${config.queuePrefix}:dryrun:sends`,
  sendTimes: (senderId: string) => `${config.queuePrefix}:dryrun:times:${senderId}`,
};

// Sends nothing; records each "send" in Redis so load tests can check duplicates, gaps and hourly counts
// across all worker processes.
function createDryrunTransport(sender: Sender): Transporter {
  return nodemailer.createTransport({
    name: 'dryrun',
    version: '1',
    send(mail, callback) {
      const emailId = String(mail.data.messageId ?? '').replace(/^<|@.*$/g, '');
      redis
        .multi()
        .hincrby(dryrunKeys.sendCounts(), emailId, 1)
        .zadd(dryrunKeys.sendTimes(sender.id), Date.now(), emailId)
        .exec()
        .then(
          () => callback(null, { envelope: mail.message.getEnvelope(), messageId: String(mail.data.messageId) }),
          (err: Error) => callback(err, undefined as never),
        );
    },
  });
}

// nodemailer resolves hosts with its own DNS queries, which took ~11 s on some networks and are only cached
// for 5 minutes, so every new pooled connection after an idle spell paid it again. The OS resolver is fast.
async function createSmtpTransport(sender: Sender): Promise<Transporter> {
  const { address } = await lookup(sender.smtpHost);
  return nodemailer.createTransport({
    host: address,
    port: sender.smtpPort,
    secure: sender.smtpPort === 465,
    auth: { user: sender.smtpUser, pass: sender.smtpPass },
    tls: { servername: sender.smtpHost },
    pool: true,
  });
}

export function getTransport(sender: Sender): Promise<Transporter> {
  let transport = transports.get(sender.id);
  if (!transport) {
    transport =
      config.emailTransport === 'dryrun' ? Promise.resolve(createDryrunTransport(sender)) : createSmtpTransport(sender);
    transport.catch(() => transports.delete(sender.id));
    transports.set(sender.id, transport);
  }
  return transport;
}

// Opens one pooled connection per sender at boot, so the first send doesn't pay the handshake.
export async function warmUpTransports(senders: Sender[]): Promise<void> {
  if (config.emailTransport === 'dryrun') return;
  await Promise.allSettled(senders.map(async (sender) => (await getTransport(sender)).verify()));
}

export function closeTransports(): void {
  for (const transport of transports.values()) void transport.then((t) => t.close(), () => undefined);
  transports.clear();
}
