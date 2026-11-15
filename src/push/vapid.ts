import "server-only";

/**
 * The key pair that lets this server send a push to a browser.
 *
 * Web Push is not a service anybody signs up for: the browser hands the site an endpoint at a push
 * service, and the site proves it is itself with a VAPID signature. The public half is given to the
 * browser when it subscribes; the private half signs every push. Both are configuration, and the
 * private half is a credential.
 *
 * Absent keys are a normal state, not an error. A deployment that has not configured push simply does
 * not send push, and the interface says so instead of showing a button that cannot work. That is why
 * this returns null rather than throwing.
 */
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

export function vapidKeys(): VapidKeys | null {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim() || "mailto:support@annapurnalink.example";
  if (!publicKey || !privateKey) return null;
  // A misconfigured key that is present but wrong fails inside the signing step on every single send,
  // one device at a time. Checking the shape here turns that into one clear answer: push is off.
  if (publicKey.length < 40 || privateKey.length < 20) return null;
  // The same reasoning applies to the contact address. Push services require a `mailto:` or `https:`
  // subject and the signing step refuses anything else, so a bare email address here would leave the
  // toggle looking live while every send failed before it left this server.
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) return null;
  return { publicKey, privateKey, subject };
}

export function pushConfigured(): boolean {
  return vapidKeys() !== null;
}
