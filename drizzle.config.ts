import { defineConfig } from "drizzle-kit";
import { databaseUrl } from "./src/lib/database-config";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl("MIGRATION_DATABASE_URL") ?? "postgres://migration:local-only@localhost:5432/annapurna_link",
  },
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
  migrations: { prefix: "timestamp" },
});
