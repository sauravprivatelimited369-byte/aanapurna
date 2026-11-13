// Loopback-only page that renders the private local test inbox (.local-data/inbox.eml).
// Read-only: it never sends mail and refuses any non-loopback bind address.
import { resolve } from 'node:path';
import { INBOX_PATH, INBOX_VIEWER_PORT, startInboxViewer } from './launch-support.mjs';

if (process.env.NODE_ENV === 'production' || process.env.OPERATIONS_ENABLED === 'true') {
  console.error('The private test inbox is for local development only.');
  process.exit(1);
}

const inboxPath = resolve(process.env.LOCAL_SMTP_INBOX_PATH ?? INBOX_PATH);
const viewer = await startInboxViewer({ inboxPath, port: INBOX_VIEWER_PORT, host: '127.0.0.1' });
console.log(`Private test inbox (local only): ${viewer.url}`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await viewer.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
