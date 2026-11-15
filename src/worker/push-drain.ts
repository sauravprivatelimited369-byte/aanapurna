import type { Pool } from "pg";
import { sendPushToUser } from "@/push/deliver";

/**
 * Deliver pending notifications to the devices their owners registered.
 *
 * Driven from the notification rows, not from the code that creates them. Every notification in this
 * system is written by a database function, so a worker sweeping what was written covers all of them —
 * including the ones that fan out to an unbounded set of people — and means a new notification kind is
 * push-enabled the day it is added rather than when somebody remembers to wire it.
 *
 * The batch is bounded by `app_unpushed_notifications`: the last fifteen minutes, at most five hundred.
 * A worker that was down for a night must not wake up and fire stale pushes about food that was
 * collected yesterday. Anything older is left marked undelivered-but-skipped, which is honest — the
 * person has the in-app list and the email, and a push at that point would be noise about a finished
 * event.
 */
export type PushDrainResult = { considered: number; delivered: number; failed: number; revoked: number };

export async function drainPushOnce(pool: Pool): Promise<PushDrainResult> {
  const result: PushDrainResult = { considered: 0, delivered: 0, failed: 0, revoked: 0 };

  const batch = await pool.query<{ id: string; user_id: string; title: string; body: string; href: string | null }>(
    "select id, user_id, title, body, href from public.app_unpushed_notifications($1)",
    [100],
  );
  if (batch.rows.length === 0) return result;

  const delivered: string[] = [];
  // One person can have several notifications in a batch. Sending each separately would put four
  // entries on a lock screen for one event, so they are grouped: the first is pushed, and the rest are
  // folded into the same mark-delivered call. A person who needs the detail opens the list.
  const byUser = new Map<string, typeof batch.rows>();
  for (const row of batch.rows) {
    const existing = byUser.get(row.user_id);
    if (existing) existing.push(row);
    else byUser.set(row.user_id, [row]);
  }

  for (const [userId, rows] of byUser) {
    result.considered += rows.length;
    const first = rows[0]!;
    try {
      const sent = await sendPushToUser(userId, {
        title: first.title,
        body: rows.length > 1 ? `${first.body} (+${rows.length - 1} more)` : first.body,
        href: first.href,
      });
      result.delivered += sent.delivered;
      result.revoked += sent.revoked;
      result.failed += sent.failed;
      // Marked even when there was no device: otherwise every notification from a person who never
      // enabled push is re-examined on every drain for the fifteen minutes it stays in the window.
      for (const row of rows) delivered.push(row.id);
    } catch {
      // Left undelivered so the next pass retries it, and never propagated: a push problem must not
      // stop the rest of the batch or the other worker tasks.
      result.failed += rows.length;
    }
  }

  if (delivered.length > 0) {
    await pool.query("select public.app_mark_push_delivered($1::uuid[])", [delivered]);
  }
  return result;
}
