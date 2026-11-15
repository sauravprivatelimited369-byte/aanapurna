/**
 * Backup manifest: a small, deterministic fingerprint of a database used to prove
 * that a restore produced what was backed up.
 *
 * A restore is only "proven" when the restored copy can be compared against a
 * recorded expectation. Row counts alone miss content changes, so the manifest
 * also fingerprints the schema and the policy inventory - the two things that
 * silently differ after a partial restore.
 */
export type BackupManifest = {
  capturedAt: string;
  source: string;
  tables: Record<string, number>;
  totalRows: number;
  schemaFingerprint: string;
  migrations: number;
  policies: number;
};

/** SQL that produces the manifest on any database holding this schema. */
export const MANIFEST_SQL = `with tables as (
  select c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relispartition
), counts as (
  select name,
    (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', name), false, true, '')))[1]::text::bigint as rows
  from tables
), schema_fp as (
  select md5(string_agg(column_key, '|' order by column_key)) as fp
  from (
    select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable as column_key
    from information_schema.columns where table_schema = 'public'
  ) s
)
select json_build_object(
  'capturedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'source', current_database(),
  'tables', (select json_object_agg(name, rows) from counts),
  'totalRows', (select sum(rows) from counts),
  'schemaFingerprint', (select fp from schema_fp),
  'migrations', (select count(*) from drizzle.__drizzle_migrations),
  'policies', (
    select count(*) from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  )
) as manifest;`;

export type ManifestDifference = { field: string; expected: string; actual: string };

export function compareManifests(expected: BackupManifest, actual: BackupManifest): ManifestDifference[] {
  const differences: ManifestDifference[] = [];
  if (expected.schemaFingerprint !== actual.schemaFingerprint) {
    differences.push({ field: "schemaFingerprint", expected: expected.schemaFingerprint, actual: actual.schemaFingerprint });
  }
  if (expected.migrations !== actual.migrations) {
    differences.push({ field: "migrations", expected: String(expected.migrations), actual: String(actual.migrations) });
  }
  if (expected.policies !== actual.policies) {
    differences.push({ field: "policies", expected: String(expected.policies), actual: String(actual.policies) });
  }
  const names = new Set([...Object.keys(expected.tables), ...Object.keys(actual.tables)]);
  for (const name of [...names].sort()) {
    const want = expected.tables[name] ?? 0;
    const got = actual.tables[name] ?? 0;
    if (want !== got) differences.push({ field: `tables.${name}`, expected: String(want), actual: String(got) });
  }
  return differences;
}

/**
 * Rows that legitimately change between the backup and the check: rate limits
 * expire, sessions rotate, and the outbox drains. Everything else must match.
 */
export const VOLATILE_TABLES = new Set(["api_rate_limits", "rate_limit", "session", "email_outbox"]);

/** Counts that are expected to match exactly; used for the pass/fail summary. */
export function durableDifferences(differences: ManifestDifference[]): ManifestDifference[] {
  return differences.filter((difference) => {
    const table = difference.field.startsWith("tables.") ? difference.field.slice("tables.".length) : "";
    return !VOLATILE_TABLES.has(table);
  });
}
