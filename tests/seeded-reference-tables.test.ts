import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./integration/seeded-reference-tables.json";
import { readdirSync } from "node:fs";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const fixtures = ["tests/integration/local-domain.ts", "scripts/run-local-workflow.mjs"];
const allowed = Object.keys((manifest as { tables: Record<string, string> }).tables);

describe("the empty-database allow-list is one rule, not two", () => {
  it("has a stated reason for every table a migration may leave populated", () => {
    // The allow-list is the only place a pre-populated table is permitted to exist. If an entry ever
    // arrives without a reason, the next person cannot tell reference data from a migration
    // smuggling state, and this assertion stops being a guard.
    for (const table of allowed) {
      const reason = (manifest as { tables: Record<string, string> }).tables[table];
      expect(reason, `${table} needs a reason, not just a name`).toMatch(/migration \d+|read-only|configuration/);
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  it("only names tables that exist in the schema and are created by a migration", () => {
    const schema = read("src/db/schema.ts");
    const migrationSql = readdirSync(path.join(root, "drizzle"))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => read(path.join("drizzle", file)))
      .join("\n");
    for (const table of allowed) {
      expect(schema, `${table} is in the allow-list but not in the schema`).toContain(`pgTable("${table}"`);
      expect(migrationSql, `${table} is in the allow-list but no migration creates it`).toContain(table);
    }
  });

  it("is read by both fixtures rather than copied into them", () => {
    // These two copies drifted: the domain test learned about data_retention_settings and the browser
    // workflow did not, so one job passed while the other failed on the same migration. Reading one
    // file is what makes that impossible. This test fails if anyone re-inlines the list.
    for (const fixture of fixtures) {
      const source = read(fixture);
      expect(source, `${fixture} must import the shared allow-list`).toContain("seeded-reference-tables.json");
      expect(source, `${fixture} must derive the set from the shared allow-list`).toContain(
        "Object.keys(seededReferenceTables_manifest.tables)",
      );
      // A literal table name in a Set would mean a second copy of the rule has appeared.
      const literal = new RegExp(`new Set\\(\\[[^\\]]*(?:${allowed.join("|")})`);
      expect(literal.test(source), `${fixture} appears to inline the table list again`).toBe(false);
    }
  });
});
