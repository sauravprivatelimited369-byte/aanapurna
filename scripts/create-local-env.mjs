import { randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";

const envPath = new URL("../.env", import.meta.url);
const templatePath = new URL("../.env.example", import.meta.url);

try {
  await access(envPath);
  throw new Error(".env already exists; refusing to replace local credentials.");
} catch (error) {
  if (error instanceof Error && error.message.includes("already exists")) throw error;
}

const template = await readFile(templatePath, "utf8");
const databasePassword = () => randomBytes(24).toString("base64url");
const values = {
  POSTGRES_PASSWORD: databasePassword(),
  APP_DB_PASSWORD: databasePassword(),
  AUTH_DB_PASSWORD: databasePassword(),
  WORKER_DB_PASSWORD: databasePassword(),
  AUTH_SECRET: randomBytes(48).toString("base64url"),
  OTP_HASH_KEY: randomBytes(32).toString("base64"),
  OTP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  EMAIL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

let environment = template;
for (const [key, value] of Object.entries(values)) {
  environment = environment.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
}
for (const [key, role, passwordKey] of [
  ["DATABASE_URL", "annapurna_app", "APP_DB_PASSWORD"],
  ["AUTH_DATABASE_URL", "annapurna_auth", "AUTH_DB_PASSWORD"],
  ["WORKER_DATABASE_URL", "annapurna_worker", "WORKER_DB_PASSWORD"],
  ["MIGRATION_DATABASE_URL", "annapurna_migrator", "POSTGRES_PASSWORD"],
]) {
  const password = values[passwordKey];
  const url = `postgres://${role}:${password}@127.0.0.1:5432/annapurna_link`;
  environment = environment.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${url}`);
}

await writeFile(envPath, environment, { flag: "wx", mode: 0o600 });
console.info("Created .env with fresh local-only credentials. Keep it private; it is excluded from Git.");
