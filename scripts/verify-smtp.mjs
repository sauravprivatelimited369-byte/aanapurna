// Operator-invoked provider probe. Never logs credentials, addresses, or SMTP responses.
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

export async function runSmtpProbe(env, createTransport = nodemailer.createTransport) {
  if (env.RUN_SMTP_VERIFY !== 'true') throw new Error('Set RUN_SMTP_VERIFY=true to explicitly test your configured external SMTP provider.');
  let url;
  try { url = new URL(env.SMTP_URL ?? 'invalid:'); } catch { throw new Error('Invalid SMTP configuration.'); }
  if (!['smtp:', 'smtps:'].includes(url.protocol) || !url.hostname || url.hostname === 'localhost' || url.hostname === 'mailpit' || !url.hostname.includes('.') || isIP(url.hostname) || url.search || url.hash || (url.pathname && url.pathname !== '/') || !url.username || !url.password) {
    throw new Error('SMTP_URL must be an authenticated external smtp or smtps URL without query parameters or a path.');
  }
  if (!env.SMTP_FROM || /[\r\n]/.test(env.SMTP_FROM)) throw new Error('Configure your verified SMTP_FROM sender.');
  const sendTest = env.RUN_SMTP_SEND_TEST === 'true';
  const recipient = env.SMTP_TEST_TO;
  if (sendTest && (!recipient || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(recipient))) {
    throw new Error('SMTP_TEST_TO must be one operator-controlled email address when sending a test.');
  }
  const port = Number(url.port || (url.protocol === 'smtps:' ? 465 : 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP port.');
  let user, pass;
  try { user = decodeURIComponent(url.username); pass = decodeURIComponent(url.password); } catch { throw new Error('Invalid SMTP configuration.'); }
  const transport = createTransport({
    host: url.hostname, port, secure: url.protocol === 'smtps:', requireTLS: true,
    auth: { user, pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    tls: { rejectUnauthorized: true },
  });
  try {
    await transport.verify();
    if (sendTest) {
      const result = await transport.sendMail({
        from: env.SMTP_FROM, to: recipient,
        subject: 'Annapurna Link email configuration test',
        text: 'This is an operator-requested email configuration test. It does not confirm partner approval, food safety, or authorization for real operations.',
      });
      if (!result.accepted?.length || result.rejected?.length) throw new Error('Recipient was not accepted.');
      return 'SMTP authenticated and accepted one test message. Check the operator-controlled inbox, including spam; acceptance alone does not prove delivery.';
    }
    return 'SMTP TLS connection and authentication succeeded. No email was sent; sender verification and inbox delivery still require a controlled provider test.';
  } catch {
    // Provider messages can echo private hostnames, credentials or other sensitive details.
    throw new Error('SMTP connection, authentication, or test-message acceptance failed. Inspect your private provider configuration and server-side diagnostics.');
  } finally { transport.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSmtpProbe(process.env).then((message) => console.log(message)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Invalid SMTP configuration.');
    process.exitCode = 1;
  });
}
