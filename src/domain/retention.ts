import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { pool, withUserContext, type AppTransaction } from "@/db";
import { dataRetentionSettings, dataScrubLog, retentionHolds } from "@/db/schema";
import { HttpError } from "@/lib/http";
import type { Identity } from "@/lib/identity";
import {
  DEFAULT_RETENTION_SETTINGS,
  canErase,
  canReadRetention,
  canWriteRetention,
  type RetentionCategory,
  type RetentionSettings,
  validateRetentionSettings,
} from "@/domain/retention-policy";

/**
 * The retention controls, as staff can actually exercise them.
 *
 * The sweep itself lives in `app_apply_retention` because deletion has to be one transaction with
 * one log row per action. Everything here is the thin, permission-checked surface over it. Nothing in
 * this module can widen a window beyond the CHECK constraint, and nothing can run a sweep without
 * passing through `assertRetentionAccess` first.
 */

function assertRetentionAccess(identity: Identity): void {
  if (!canReadRetention(identity)) {
    throw new HttpError(403, "You do not have permission to view retention settings.", "RETENTION_ACCESS_DENIED");
  }
}

function assertRetentionWrite(identity: Identity): void {
  if (!canWriteRetention(identity)) {
    throw new HttpError(
      403,
      "Only operations and security administrators can change retention or place a hold.",
      "RETENTION_WRITE_DENIED",
    );
  }
}

export type RetentionStatus = {
  settings: RetentionSettings;
  updatedAt: Date | null;
  updatedBy: string | null;
  activeHolds: number;
  lastRuns: Array<{
    runId: string;
    executedAt: Date;
    dryRun: boolean;
    categories: Array<{ category: string; action: string; affectedRows: number; skippedByHold: number }>;
  }>;
};

/** Read the current windows and the most recent sweeps. */
export async function getRetentionStatus(identity: Identity): Promise<RetentionStatus> {
  assertRetentionAccess(identity);
  return withUserContext(identity.id, async (tx) => {
    const [row] = await tx.select().from(dataRetentionSettings).where(eq(dataRetentionSettings.id, 1)).limit(1);
    const settings: RetentionSettings = row
      ? {
          notificationsDays: row.notificationsDays,
          otpDays: row.otpDays,
          deliveryCodesDays: row.deliveryCodesDays,
          closedIncidentsDays: row.closedIncidentsDays,
          failedJobsDays: row.failedJobsDays,
          auditYears: row.auditYears,
        }
      : DEFAULT_RETENTION_SETTINGS;

    const [held] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(retentionHolds)
      .where(isNull(retentionHolds.releasedAt));

    const recent = await tx
      .select({
        runId: dataScrubLog.runId,
        executedAt: dataScrubLog.executedAt,
        dryRun: dataScrubLog.dryRun,
        category: dataScrubLog.category,
        action: dataScrubLog.action,
        affectedRows: dataScrubLog.affectedRows,
        skippedByHold: dataScrubLog.skippedByHold,
      })
      .from(dataScrubLog)
      .orderBy(desc(dataScrubLog.executedAt))
      .limit(60);

    const runMap = new Map<string, RetentionStatus["lastRuns"][number]>();
    for (const line of recent) {
      const key = line.runId;
      const existing = runMap.get(key);
      if (existing) {
        existing.categories.push({
          category: line.category,
          action: line.action,
          affectedRows: line.affectedRows,
          skippedByHold: line.skippedByHold,
        });
      } else {
        runMap.set(key, {
          runId: key,
          executedAt: line.executedAt,
          dryRun: line.dryRun,
          categories: [{
            category: line.category,
            action: line.action,
            affectedRows: line.affectedRows,
            skippedByHold: line.skippedByHold,
          }],
        });
      }
    }

    return {
      settings,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
      activeHolds: held?.count ?? 0,
      lastRuns: [...runMap.values()].slice(0, 5),
    };
  });
}

/**
 * Change a window. Widening a window is a decision with a privacy cost, and shrinking one deletes
 * data earlier, so both are recorded with the person and the time rather than overwritten quietly.
 */
export async function updateRetentionSettings(
  identity: Identity,
  input: Partial<Record<keyof RetentionSettings, unknown>>,
): Promise<RetentionSettings> {
  assertRetentionWrite(identity);
  const { ok, settings, errors } = validateRetentionSettings(input);
  if (!ok) {
    throw new HttpError(422, errors.join("; "), "RETENTION_SETTINGS_INVALID");
  }
  return withUserContext(
    identity.id,
    async (tx) => {
      const [row] = await tx
        .update(dataRetentionSettings)
        .set({ ...settings, updatedBy: identity.id, updatedAt: new Date() })
        .where(eq(dataRetentionSettings.id, 1))
        .returning();
      return {
        notificationsDays: row!.notificationsDays,
        otpDays: row!.otpDays,
        deliveryCodesDays: row!.deliveryCodesDays,
        closedIncidentsDays: row!.closedIncidentsDays,
        failedJobsDays: row!.failedJobsDays,
        auditYears: row!.auditYears,
      };
    },
    { domainTransition: true },
  );
}

/**
 * Run the sweep. `dryRun` counts without deleting, and the counts are what the caller shows before
 * asking for a real run — so the preview is produced by the same code that later acts.
 */
export async function runRetentionSweep(
  identity: Identity | null,
  options: { dryRun: boolean },
): Promise<{
  dryRun: boolean;
  results: Array<{ category: string; action: string; affectedRows: number; skippedByHold: number }>;
  totalAffected: number;
  totalHeld: number;
}> {
  if (identity) assertRetentionWrite(identity);

  const execute = async (tx: AppTransaction) => {
    const result = await tx.execute<{
      category: string;
      action: string;
      affected_rows: number;
      skipped_by_hold: number;
    }>(sql`select * from public.app_apply_retention(${options.dryRun})`);
    return result.rows.map((row) => ({
      category: row.category,
      action: row.action,
      affectedRows: Number(row.affected_rows),
      skippedByHold: Number(row.skipped_by_hold),
    }));
  };

  // A staff-initiated run carries the acting identity and its transaction-local context. The worker
  // has no signed-in user, so it runs against the pool directly: `app_apply_retention` is SECURITY
  // DEFINER and reads nothing from `app.user_id`, so no identity is needed to sweep.
  const results = identity
    ? await withUserContext(identity.id, execute, { domainTransition: true })
    : await (async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await client.query<{
            category: string;
            action: string;
            affected_rows: number;
            skipped_by_hold: number;
          }>("select * from public.app_apply_retention($1)", [options.dryRun]);
          await client.query("COMMIT");
          return result.rows.map((row) => ({
            category: row.category,
            action: row.action,
            affectedRows: Number(row.affected_rows),
            skippedByHold: Number(row.skipped_by_hold),
          }));
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
      })();

  return {
    dryRun: options.dryRun,
    results,
    totalAffected: results.reduce((sum, row) => sum + row.affectedRows, 0),
    totalHeld: results.reduce((sum, row) => sum + row.skippedByHold, 0),
  };
}

export type PlaceHoldInput = {
  scopeType: "user" | "organization" | "job" | "donation";
  subjectId: string;
  reason: string;
};

/** Put a record beyond the reach of every retention window, with a name and a reason against it. */
export async function placeRetentionHold(identity: Identity, input: PlaceHoldInput) {
  assertRetentionWrite(identity);
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw new HttpError(422, "A hold needs a reason of at least 10 characters.", "HOLD_REASON_TOO_SHORT");
  }
  if (!input.subjectId) {
    throw new HttpError(422, "A hold must name the record it covers.", "HOLD_SUBJECT_REQUIRED");
  }
  return withUserContext(
    identity.id,
    async (tx) => {
      const [hold] = await tx
        .insert(retentionHolds)
        .values({
          scopeType: input.scopeType,
          userId: input.scopeType === "user" ? input.subjectId : null,
          organizationId: input.scopeType === "organization" ? input.subjectId : null,
          deliveryJobId: input.scopeType === "job" ? input.subjectId : null,
          donationId: input.scopeType === "donation" ? input.subjectId : null,
          reason,
          placedBy: identity.id,
        })
        .returning();
      return hold!;
    },
    { domainTransition: true },
  );
}

/** Release a hold. The row stays, so the decision keeps its history. */
export async function releaseRetentionHold(identity: Identity, holdId: string, reason: string) {
  assertRetentionWrite(identity);
  const releaseReason = reason.trim();
  if (releaseReason.length < 10) {
    throw new HttpError(422, "Releasing a hold needs a reason of at least 10 characters.", "HOLD_RELEASE_REASON_TOO_SHORT");
  }
  return withUserContext(
    identity.id,
    async (tx) => {
      const [hold] = await tx
        .update(retentionHolds)
        .set({ releasedBy: identity.id, releasedAt: new Date(), releaseReason })
        .where(and(eq(retentionHolds.id, holdId), isNull(retentionHolds.releasedAt)))
        .returning();
      if (!hold) throw new HttpError(404, "That hold is not active, or does not exist.", "HOLD_NOT_FOUND");
      return hold;
    },
    { domainTransition: true },
  );
}

export async function listRetentionHolds(identity: Identity, options: { includeReleased: boolean }) {
  assertRetentionAccess(identity);
  return withUserContext(identity.id, async (tx) => {
    const rows = await tx
      .select()
      .from(retentionHolds)
      .where(options.includeReleased ? sql`true` : isNull(retentionHolds.releasedAt))
      .orderBy(desc(retentionHolds.placedAt))
      .limit(100);
    return rows;
  });
}

/**
 * Fulfil an erasure request by overwriting the person, not by deleting the accountability around them.
 * Restricted to security administrators, because it cannot be undone.
 */
export async function erasePerson(identity: Identity, userId: string, reason: string) {
  if (!canErase(identity)) {
    throw new HttpError(403, "Only a security administrator can erase a person's data.", "ERASURE_ACCESS_DENIED");
  }
  if (!userId) throw new HttpError(422, "A user id is required.", "ERASURE_SUBJECT_REQUIRED");
  if (reason.trim().length < 10) {
    throw new HttpError(422, "An erasure needs a recorded reason of at least 10 characters.", "ERASURE_REASON_TOO_SHORT");
  }
  return withUserContext(
    identity.id,
    async (tx) => {
      const result = await tx.execute<{
        redacted_users: number;
        redacted_accounts: number;
        redacted_profiles: number;
        redacted_notifications: number;
      }>(sql`select * from public.app_redact_user(${userId}, ${reason.trim()})`);
      return result.rows[0];
    },
    { domainTransition: true },
  );
}

/** What a person is told when they ask where their data went. */
export async function describeRetentionForCategory(category: RetentionCategory): Promise<string> {
  const { cutoffFor, RETENTION_ACTIONS } = await import("@/domain/retention-policy");
  const status = { ...DEFAULT_RETENTION_SETTINGS };
  const cutoff = cutoffFor(category, status, new Date());
  const verb = RETENTION_ACTIONS[category] === "delete" ? "deleted" : "scrubbed";
  return `${category.replaceAll("_", " ")} older than ${cutoff.toISOString().slice(0, 10)} ${verb}`;
}
