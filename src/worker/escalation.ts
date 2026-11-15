import "server-only";
import type { Pool } from "pg";

/**
 * Backlog escalation sweep.
 *
 * Two failures were invisible before this existed:
 *
 *  - A delivery job that becomes claimable and is never claimed. Nothing told
 *    operations; the food simply sat until its pickup window closed.
 *  - Partner evidence (licences, registrations) expiring while the organisation
 *    stayed verified. Re-validation was a manual list nobody was reminded to
 *    read.
 *
 * `app_escalate_delivery_backlog` reports each job and each document once, so a
 * five-minute schedule cannot become a notification flood. This module is the
 * thin caller shared by the long-lived Graphile Worker and the hosted drain
 * route, mirroring how the email outbox is driven from both.
 */

export type EscalationResult = {
  unclaimedJobs: number;
  expiringDocuments: number;
};

/** Minutes an open job may sit unclaimed before operations are told. */
export const DEFAULT_ESCALATION_THRESHOLD_MINUTES = 30;

/** Days before expiry at which partner evidence is escalated. */
export const DEFAULT_DOCUMENT_HORIZON_DAYS = 14;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function escalationThresholdMinutes(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInteger(env.ESCALATION_THRESHOLD_MINUTES, DEFAULT_ESCALATION_THRESHOLD_MINUTES);
}

export function escalationDocumentHorizonDays(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInteger(env.ESCALATION_DOCUMENT_HORIZON_DAYS, DEFAULT_DOCUMENT_HORIZON_DAYS);
}

export async function runEscalationSweep(
  pool: Pool,
  options: { thresholdMinutes?: number; documentHorizonDays?: number } = {},
): Promise<EscalationResult> {
  const threshold = options.thresholdMinutes ?? escalationThresholdMinutes();
  const horizon = options.documentHorizonDays ?? escalationDocumentHorizonDays();
  const { rows } = await pool.query<{ unclaimed_jobs: number; expiring_documents: number }>(
    "select * from public.app_escalate_delivery_backlog($1, $2)",
    [threshold, horizon],
  );
  return {
    unclaimedJobs: Number(rows[0]?.unclaimed_jobs ?? 0),
    expiringDocuments: Number(rows[0]?.expiring_documents ?? 0),
  };
}
