/**
 * Retention CLI.
 *
 *   npm run retention -- --dry-run     # what would be deleted or scrubbed, counted, nothing changed
 *   npm run retention                  # run every window for real
 *
 * The preview and the real run call the same database function, so approving the preview is
 * approving the sweep. This script never widens a window and never touches a held record.
 */
import { Pool } from "pg";
import { databaseConnectionTimeoutMillis, databaseSslOptions, databaseUrl } from "../src/lib/database-config";

type Row = { category: string; action: string; affected_rows: number; skipped_by_hold: number };

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? `${error.message} | cause: ${cause.message}` : error.message;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const connectionString = databaseUrl("DATABASE_URL");
  if (!connectionString) throw new Error("DATABASE_URL is required to run retention.");

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
    application_name: "annapurna-link-retention-cli",
    ssl: databaseSslOptions(connectionString),
  });

  try {
    const settings = await pool.query<{
      notifications_days: number;
      otp_days: number;
      delivery_codes_days: number;
      closed_incidents_days: number;
      failed_jobs_days: number;
      audit_years: number;
    }>("select * from public.data_retention_settings where id = 1");
    const s = settings.rows[0];
    if (!s) throw new Error("data_retention_settings row 1 is missing; run npm run db:migrate first.");

    console.log(JSON.stringify({ level: "info", event: "retention.windows", dryRun, windows: {
      notificationsDays: s.notifications_days,
      otpDays: s.otp_days,
      deliveryCodesDays: s.delivery_codes_days,
      closedIncidentsDays: s.closed_incidents_days,
      failedJobsDays: s.failed_jobs_days,
      auditYears: s.audit_years,
    } }));

    const { rows } = await pool.query<Row>("select * from public.app_apply_retention($1)", [dryRun]);
    let affected = 0;
    let held = 0;
    for (const row of rows) {
      affected += Number(row.affected_rows);
      held += Number(row.skipped_by_hold);
      console.log(JSON.stringify({
        level: "info",
        event: dryRun ? "retention.preview" : "retention.applied",
        category: row.category,
        action: row.action,
        affectedRows: Number(row.affected_rows),
        skippedByHold: Number(row.skipped_by_hold),
      }));
    }

    console.log(JSON.stringify({
      level: "info",
      event: "retention.summary",
      dryRun,
      totalAffected: affected,
      totalSkippedByHold: held,
      ...(dryRun ? { note: "Nothing was changed. Re-run without --dry-run to apply." } : {}),
    }));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "retention.failed", message: describeError(error) }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", event: "retention.failed", message: describeError(error) }));
  process.exitCode = 1;
});
