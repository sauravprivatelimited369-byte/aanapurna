import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Captures the one-time password-reset link that Better Auth generates.
 *
 * Why this exists: on a deployment without a working mail provider the reset
 * flow cannot reach the person who forgot their password, and there is no way to
 * hand it to them. This lets a privileged operator, who has already proved their
 * own identity with a second factor, receive the *same* single-use link Better
 * Auth would have emailed and pass it on through a channel they control.
 *
 * The link is never logged, never written to the database by application code,
 * and never returned to any caller except the one request that asked for it.
 * Outside an explicit capture scope the callback behaves exactly as before.
 */
export type PasswordResetCapture = { url: string | null };

const storage = new AsyncLocalStorage<PasswordResetCapture>();

export function withPasswordResetCapture<T>(callback: () => Promise<T>): Promise<{ result: T; url: string | null }> {
  const capture: PasswordResetCapture = { url: null };
  return storage.run(capture, async () => {
    const result = await callback();
    return { result, url: capture.url };
  });
}

/** Called by the Better Auth reset callback. A no-op outside a capture scope. */
export function capturePasswordResetUrl(url: string): void {
  const capture = storage.getStore();
  if (capture) capture.url = url;
}
