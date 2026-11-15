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

/**
 * Readiness sweep result. Kept separate so a readiness failure cannot make the backlog sweep look
 * like it failed, and vice versa.
 */
export type ReadinessSweepResult = {
  expiringDeclarations: number;
  coverageGaps: number;
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

/** Days before expiry at which a legal, insurance or audit declaration is escalated. */
export const DEFAULT_READINESS_HORIZON_DAYS = 30;

export function readinessHorizonDays(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInteger(env.READINESS_HORIZON_DAYS, DEFAULT_READINESS_HORIZON_DAYS);
}

/**
 * Remind the people who can renew an owner declaration, and say out loud when nobody is on call.
 * The records themselves cannot rot silently after this: a lapsing policy and a rota gap both
 * produce a notification that the operations console shows.
 */
export async function runReadinessSweep(
  pool: Pool,
  options: { horizonDays?: number } = {},
): Promise<ReadinessSweepResult> {
  const horizon = options.horizonDays ?? readinessHorizonDays();
  const { rows } = await pool.query<{ expiring_declarations: number; coverage_gaps: number }>(
    "select * from public.app_escalate_platform_readiness($1)",
    [horizon],
  );
  return {
    expiringDeclarations: Number(rows[0]?.expiring_declarations ?? 0),
    coverageGaps: Number(rows[0]?.coverage_gaps ?? 0),
  };
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

export type RetentionSweepResult = {
  totalAffected: number;
  totalHeld: number;
  categories: number;
};

/**
 * Run the retention windows. Separate from every other sweep because a bug here deletes data, and
 * a failing mail drain must never take the retention job down with it — or the reverse.
 *
 * The work happens inside `app_apply_retention`, which logs one row per category and skips anything
 * under an active legal hold. This function only reports what happened.
 */
export async function runRetentionSweep(pool: Pool): Promise<RetentionSweepResult> {
  const { rows } = await pool.query<{ category: string; action: string; affected_rows: number; skipped_by_hold: number }>(
    "select * from public.app_apply_retention(false)",
  );
  return {
    totalAffected: rows.reduce((sum, row) => sum + Number(row.affected_rows), 0),
    totalHeld: rows.reduce((sum, row) => sum + Number(row.skipped_by_hold), 0),
    categories: rows.length,
  };
}
