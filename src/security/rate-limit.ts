import "server-only";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { HttpError } from "@/lib/http";

function opaqueKey(bucket: string, subject: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is required for rate limiting.");
  return createHmac("sha256", secret ?? "local-development-rate-limit")
    .update(`${bucket}:${subject}`)
    .digest("hex");
}

export async function enforceRateLimit(options: {
  bucket: string;
  subject: string;
  max: number;
  windowSeconds: number;
}): Promise<void> {
  const key = opaqueKey(options.bucket, options.subject);
  const result = await db.execute<{ count: number; window_started_at: Date }>(sql`
    insert into api_rate_limits (key, window_started_at, count, expires_at)
    values (${key}, now(), 1, now() + (${options.windowSeconds} * interval '1 second'))
    on conflict (key) do update set
      count = case
        when api_rate_limits.window_started_at + (${options.windowSeconds} * interval '1 second') <= now() then 1
        else api_rate_limits.count + 1
      end,
      window_started_at = case
        when api_rate_limits.window_started_at + (${options.windowSeconds} * interval '1 second') <= now() then now()
        else api_rate_limits.window_started_at
      end,
      expires_at = now() + (${options.windowSeconds} * interval '1 second')
    returning count, window_started_at
  `);
  const currentCount = Number(result.rows[0]?.count ?? 0);
  if (currentCount > options.max) throw new HttpError(429, "Too many attempts. Wait a little and try again.", "RATE_LIMITED");
  if (Math.random() < 0.01) {
    void db.execute(sql`delete from api_rate_limits where expires_at < now()`).catch(() => undefined);
  }
}

export async function enforceMutationRateLimit(options: {
  request: Request;
  userId: string;
  bucket: string;
  userMax?: number;
  ipMax?: number;
}): Promise<void> {
  await enforceRateLimit({
    bucket: `mutation:${options.bucket}:user`,
    subject: options.userId,
    max: options.userMax ?? 30,
    windowSeconds: 60,
  });
  await enforceRateLimit({
    bucket: `mutation:${options.bucket}:ip`,
    subject: getRequestAddressKey(options.request),
    max: options.ipMax ?? 120,
    windowSeconds: 60,
  });
}

export function getRequestAddressKey(request: Request): string {
  // Proxy-provided address is never stored directly; the limiter HMACs it before persistence.
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
