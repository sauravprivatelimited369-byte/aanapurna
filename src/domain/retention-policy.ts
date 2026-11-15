import type { Identity } from "@/lib/identity";

/**
 * The retention vocabulary, kept free of database imports so the arithmetic can be tested directly.
 *
 * Every number here is a maximum age. Nothing is deleted early, and a category can be previewed
 * without writing anything, which is what makes the approval step meaningful.
 */

export const RETENTION_CATEGORIES = [
  "notifications",
  "otp_verification",
  "delivery_codes",
  "closed_incidents",
  "failed_jobs",
  "audit_details",
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

export type RetentionSettings = {
  notificationsDays: number;
  otpDays: number;
  deliveryCodesDays: number;
  closedIncidentsDays: number;
  failedJobsDays: number;
  auditYears: number;
};

export type RetentionCategoryResult = {
  category: RetentionCategory | "audit_events_old";
  action: "delete" | "scrub" | "skip";
  affectedRows: number;
  skippedByHold: number;
};

export type RetentionRun = {
  dryRun: boolean;
  at: Date;
  results: RetentionCategoryResult[];
  totalAffected: number;
  totalHeld: number;
};

/** Bounds enforced by the CHECK constraint in migration 21. Repeated here to fail before the round trip. */
export const RETENTION_BOUNDS: Record<keyof RetentionSettings, { min: number; max: number; unit: "days" | "years" }> = {
  notificationsDays: { min: 7, max: 3650, unit: "days" },
  otpDays: { min: 1, max: 30, unit: "days" },
  deliveryCodesDays: { min: 1, max: 365, unit: "days" },
  closedIncidentsDays: { min: 30, max: 3650, unit: "days" },
  failedJobsDays: { min: 1, max: 365, unit: "days" },
  auditYears: { min: 1, max: 25, unit: "years" },
};

export const DEFAULT_RETENTION_SETTINGS: RetentionSettings = {
  notificationsDays: 90,
  otpDays: 1,
  deliveryCodesDays: 30,
  closedIncidentsDays: 730,
  failedJobsDays: 30,
  auditYears: 6,
};

/**
 * A window is valid only when it is a whole number inside the bounds the database also enforces.
 * Returning every problem at once lets the form show all of them rather than one per attempt.
 */
export function validateRetentionSettings(input: Partial<Record<keyof RetentionSettings, unknown>>): {
  ok: boolean;
  settings: RetentionSettings;
  errors: string[];
} {
  const settings: RetentionSettings = { ...DEFAULT_RETENTION_SETTINGS };
  const errors: string[] = [];
  for (const key of Object.keys(RETENTION_BOUNDS) as Array<keyof RetentionSettings>) {
    const raw = input[key];
    if (raw === undefined) continue;
    const value = Number(raw);
    const bound = RETENTION_BOUNDS[key];
    if (!Number.isInteger(value)) {
      errors.push(`${key} must be a whole number of ${bound.unit}`);
      continue;
    }
    if (value < bound.min || value > bound.max) {
      errors.push(`${key} must be between ${bound.min} and ${bound.max} ${bound.unit}`);
      continue;
    }
    settings[key] = value;
  }
  return { ok: errors.length === 0, settings, errors };
}

/**
 * Scrub and delete categories are separated because they are different promises. A scrub keeps the
 * record and removes the person from it; a delete removes the row. Mixing them in one list would let
 * a UI say "deleted 12 records" when 12 records were edited.
 */
export const RETENTION_ACTIONS: Record<RetentionCategory, "delete" | "scrub"> = {
  notifications: "delete",
  otp_verification: "delete",
  delivery_codes: "delete",
  closed_incidents: "scrub",
  failed_jobs: "delete",
  audit_details: "scrub",
};

export function isRetentionCategory(value: string): value is RetentionCategory {
  return (RETENTION_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The cutoff for a category, given the settings and a reference time. This is the same arithmetic
 * `app_apply_retention` performs; the test pins the two to the same answer so the preview shown in
 * the UI cannot describe a different sweep from the one that runs.
 */
export function cutoffFor(category: RetentionCategory, settings: RetentionSettings, now: Date): Date {
  const at = new Date(now.getTime());
  switch (category) {
    case "notifications":
      return shiftDays(at, -settings.notificationsDays);
    case "otp_verification":
      return shiftDays(at, -settings.otpDays);
    case "delivery_codes":
      return shiftDays(at, -settings.deliveryCodesDays);
    case "closed_incidents":
      return shiftDays(at, -settings.closedIncidentsDays);
    case "failed_jobs":
      return shiftDays(at, -settings.failedJobsDays);
    case "audit_details":
      return shiftYears(at, -settings.auditYears);
  }
}

function shiftDays(from: Date, days: number): Date {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function shiftYears(from: Date, years: number): Date {
  const next = new Date(from.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

/** A row is past its window when it is strictly older than the cutoff. Boundary rows survive. */
export function isPastWindow(createdAt: Date, cutoff: Date): boolean {
  return createdAt.getTime() < cutoff.getTime();
}

export type HoldScope =
  | { scopeType: "user"; subjectId: string }
  | { scopeType: "organization"; subjectId: string }
  | { scopeType: "job"; subjectId: string }
  | { scopeType: "donation"; subjectId: string };

export type HoldRecord = HoldScope & {
  id: string;
  reason: string;
  placedBy: string;
  placedAt: Date;
  releasedAt: Date | null;
};

/**
 * Only unreleased holds block anything. A released hold is history: it stays readable so the
 * decision can be reviewed, but it must never stop a deletion again.
 */
export function activeHolds(holds: HoldRecord[]): HoldRecord[] {
  return holds.filter((hold) => hold.releasedAt === null);
}

/**
 * Which of a person's rows a hold covers. A user hold covers their own rows; an organisation hold
 * covers every row belonging to that organisation; a job or donation hold covers that record and
 * the rows hanging off it. Holds are additive, never subtractive.
 */
export function holdCovers(
  holds: HoldRecord[],
  subject: { userId?: string | null; organizationId?: string | null; deliveryJobId?: string | null; donationId?: string | null },
): boolean {
  return activeHolds(holds).some((hold) => {
    switch (hold.scopeType) {
      case "user":
        return Boolean(subject.userId) && subject.userId === hold.subjectId;
      case "organization":
        return Boolean(subject.organizationId) && subject.organizationId === hold.subjectId;
      case "job":
        return Boolean(subject.deliveryJobId) && subject.deliveryJobId === hold.subjectId;
      case "donation":
        return Boolean(subject.donationId) && subject.donationId === hold.subjectId;
    }
  });
}

/**
 * A run summary is only honest if it separates what happened from what was held back. "Deleted 0"
 * and "deleted 0, skipped 4 under hold" are very different answers to a person asking about their data.
 */
export function summariseRun(run: RetentionRun): string {
  if (run.results.length === 0) return run.dryRun ? "Nothing is past its retention window." : "Nothing was past its retention window.";
  const affected = run.results.filter((row) => row.affectedRows > 0);
  const held = run.totalHeld;
  const verb = run.dryRun ? "would be" : "were";
  const parts = affected.map((row) => {
    const unit = row.action === "scrub" ? "scrubbed" : "deleted";
    return `${row.affectedRows} ${row.category.replaceAll("_", " ")} row(s) ${verb} ${unit}`;
  });
  const head = parts.length === 0 ? `No rows ${verb} changed` : parts.join("; ");
  return held > 0 ? `${head}. ${held} row(s) kept under an active legal hold.` : `${head}.`;
}

/** Only the staff roles that answer privacy questions may read retention state. */
export const RETENTION_READ_ROLES = ["operations_admin", "security_admin", "safety_officer"] as const;
/** Only the two that can commit the organisation to a window may change one or place a hold. */
export const RETENTION_WRITE_ROLES = ["operations_admin", "security_admin"] as const;
/** Erasing a person is irreversible, so it is narrower still. */
export const RETENTION_ERASE_ROLES = ["security_admin"] as const;

export function canReadRetention(identity: Identity): boolean {
  return identity.platformRoles.some((role) => (RETENTION_READ_ROLES as readonly string[]).includes(role));
}

export function canWriteRetention(identity: Identity): boolean {
  return identity.platformRoles.some((role) => (RETENTION_WRITE_ROLES as readonly string[]).includes(role));
}

export function canErase(identity: Identity): boolean {
  return identity.platformRoles.some((role) => (RETENTION_ERASE_ROLES as readonly string[]).includes(role));
}

/**
 * When the nightly sweep runs. Kept here so the schedule the worker registers and the time the
 * status page quotes come from one expression.
 */
export const RETENTION_SWEEP_CRON = "15 3 * * *";
export const RETENTION_SWEEP_TIMEZONE = "Asia/Kolkata";

/** The next sweep after a given instant, in the sweep's own timezone (IST, UTC+05:30, no DST). */
export function nextSweepAt(now: Date): Date {
  const offsetMinutes = 330;
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  const next = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3, 15, 0, 0));
  if (next.getTime() <= local.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return new Date(next.getTime() - offsetMinutes * 60_000);
}

/**
 * An erasure request must not silently complete. Completing one is only allowed after the redaction
 * actually ran, so the domain function refuses to mark a request completed without a redaction time.
 */
export function assertErasureCompleted(input: { status: string; completedAt: Date | null }): void {
  if (input.status === "completed" && input.completedAt === null) {
    throw new Error("An erasure request cannot be completed before the redaction has run.");
  }
}
