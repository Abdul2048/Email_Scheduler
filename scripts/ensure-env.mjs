// Creates backend/.env from backend/.env.example on first setup, with a random SESSION_SECRET.
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../backend/.env', import.meta.url);
const example = new URL('../backend/.env.example', import.meta.url);

if (existsSync(target)) {
  console.log('backend/.env already exists, leaving it as is.');
} else {
  copyFileSync(example, target);
  const env = readFileSync(target, 'utf8').replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${randomBytes(32).toString('hex')}`);
  writeFileSync(target, env);
  console.log('Created backend/.env with a random SESSION_SECRET.');
  console.log('Add GOOGLE_CLIENT_ID/SECRET (required for login) and SLACK_CLIENT_ID/SECRET (optional) before `npm run dev`.');
}
