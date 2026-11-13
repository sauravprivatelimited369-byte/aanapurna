// Operator-invoked connectivity check. Does not send mail or log credentials.
import { isIP } from 'node:net';
import nodemailer from 'nodemailer';

async function main() {
  if (process.env.RUN_SMTP_VERIFY !== 'true') throw new Error('Set RUN_SMTP_VERIFY=true to explicitly test your configured external SMTP provider.');
  const url = new URL(process.env.SMTP_URL ?? 'invalid:');
  if (!['smtp:', 'smtps:'].includes(url.protocol) || !url.hostname || url.hostname === 'localhost' || url.hostname === 'mailpit' || !url.hostname.includes('.') || isIP(url.hostname) || url.search || url.hash || !url.username || !url.password) {
    throw new Error('SMTP_URL must be an authenticated external smtp or smtps URL without query parameters.');
  }
  if (!process.env.SMTP_FROM || process.env.SMTP_FROM.includes('\n') || process.env.SMTP_FROM.includes('\r')) throw new Error('Configure your verified SMTP_FROM sender.');
  const port = Number(url.port || (url.protocol === 'smtps:' ? 465 : 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP port.');
  const transport = nodemailer.createTransport({
    host: url.hostname, port, secure: url.protocol === 'smtps:', requireTLS: true,
    auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    tls: { rejectUnauthorized: true },
  });
  try {
    await transport.verify();
    console.log('SMTP TLS connection and authentication succeeded. No email was sent; sender verification and inbox delivery still require a controlled provider test.');
  } catch {
    // Provider messages can echo private hostnames, credentials or other sensitive details.
    throw new Error('SMTP connection or authentication failed. Inspect your private provider configuration and server-side diagnostics.');
  } finally { transport.close(); }
}
main().catch((error) => { console.error(error instanceof Error && !error.message.includes('Invalid URL') ? error.message : 'Invalid SMTP configuration.'); process.exitCode = 1; });
