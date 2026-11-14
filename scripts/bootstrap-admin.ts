import { Pool } from "pg";
import { databaseConnectionTimeoutMillis, databaseUrl } from "../src/lib/database-config";

async function main(): Promise<void> {
  const connectionString = databaseUrl("MIGRATION_DATABASE_URL");
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const reason = process.env.BOOTSTRAP_ADMIN_REASON?.trim();
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required for one-time privileged bootstrap.");
  if (!email || !reason || reason.length < 20 || reason.length > 500) {
    throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and a BOOTSTRAP_ADMIN_REASON of 20–500 characters for the explicitly authorised bootstrap.");
  }
  if (process.env.ALLOW_ADMIN_BOOTSTRAP !== "true") {
    throw new Error("Set ALLOW_ADMIN_BOOTSTRAP=true for this one-time human-authorised command; it is never enabled automatically.");
  }
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: databaseConnectionTimeoutMillis(),
    application_name: "annapurna-link-admin-bootstrap",
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query<{ id: string }>(`
        SELECT account.id
        FROM public."user" account
        JOIN public.user_profiles profile ON profile.user_id = account.id
        WHERE lower(account.email) = $1
          AND account.email_verified = true
          AND profile.account_status = 'active'
        FOR UPDATE OF profile
      `, [email]);
      if (user.rowCount !== 1) throw new Error("No single, email-verified active user matches BOOTSTRAP_ADMIN_EMAIL.");
      const userId = user.rows[0]!.id;
      const role = await client.query<{ id: string }>(`
        INSERT INTO public.platform_roles (user_id, role, reason)
        VALUES ($1, 'operations_admin', $2)
        ON CONFLICT (user_id, role) DO NOTHING
        RETURNING id
      `, [userId, reason]);
      if (role.rowCount === 1) {
        await client.query(`
          INSERT INTO public.audit_events (actor_user_id, action, entity_type, entity_id, reason, details)
          VALUES (NULL, 'platform_role.bootstrap_granted', 'platform_role', $1, $2, $3::jsonb)
        `, [role.rows[0]!.id, reason, JSON.stringify({ role: "operations_admin", targetUserId: userId, method: "one_time_bootstrap" })]);
      }
      await client.query("COMMIT");
      console.info(JSON.stringify({ level: "info", event: role.rowCount ? "platform_role.bootstrap_granted" : "platform_role.already_present", userId, role: "operations_admin" }));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "platform_role.bootstrap_failed", message: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ level: "error", event: "platform_role.bootstrap_failed", message: error instanceof Error ? error.message : "unknown" }));
  process.exitCode = 1;
});
