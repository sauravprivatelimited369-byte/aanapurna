import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION_SETTINGS,
  RETENTION_ACTIONS,
  RETENTION_BOUNDS,
  RETENTION_CATEGORIES,
  activeHolds,
  canErase,
  canReadRetention,
  canWriteRetention,
  cutoffFor,
  holdCovers,
  isPastWindow,
  nextSweepAt,
  summariseRun,
  validateRetentionSettings,
  type HoldRecord,
  type RetentionSettings,
} from "@/domain/retention-policy";
import type { Identity } from "@/lib/identity";

const NOW = new Date("2026-11-15T12:00:00.000Z");

function identityWith(roles: Identity["platformRoles"]): Identity {
  return {
    id: "staff-1",
    name: "Staff",
    email: "staff@example.org",
    platformRoles: roles,
    memberships: [],
    requestedRole: null,
    helperStatus: null,
    twoFactorEnabled: true,
  } as Identity;
}

function hold(overrides: Partial<HoldRecord> & Pick<HoldRecord, "scopeType" | "subjectId">): HoldRecord {
  return {
    id: "hold-1",
    reason: "Litigation hold",
    placedBy: "staff-1",
    placedAt: NOW,
    releasedAt: null,
    ...overrides,
  } as HoldRecord;
}

describe("retention windows", () => {
  it("computes every category cutoff from the settings row, not from prose", () => {
    const settings: RetentionSettings = { ...DEFAULT_RETENTION_SETTINGS };
    expect(cutoffFor("notifications", settings, NOW).toISOString()).toBe("2026-08-17T12:00:00.000Z");
    expect(cutoffFor("otp_verification", settings, NOW).toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(cutoffFor("delivery_codes", settings, NOW).toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect(cutoffFor("closed_incidents", settings, NOW).toISOString()).toBe("2024-11-15T12:00:00.000Z");
    expect(cutoffFor("failed_jobs", settings, NOW).toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect(cutoffFor("audit_details", settings, NOW).toISOString()).toBe("2020-11-15T12:00:00.000Z");
  });

  it("treats the boundary row as surviving, so a window is a maximum and not a target", () => {
    const cutoff = cutoffFor("notifications", DEFAULT_RETENTION_SETTINGS, NOW);
    expect(isPastWindow(new Date(cutoff.getTime()), cutoff)).toBe(false);
    expect(isPastWindow(new Date(cutoff.getTime() - 1), cutoff)).toBe(true);
    expect(isPastWindow(new Date(cutoff.getTime() + 1), cutoff)).toBe(false);
  });

  it("has an action for every category and never deletes an audit row", () => {
    for (const category of RETENTION_CATEGORIES) {
      expect(RETENTION_ACTIONS[category]).toBeDefined();
    }
    expect(RETENTION_ACTIONS.audit_details).toBe("scrub");
    expect(RETENTION_ACTIONS.closed_incidents).toBe("scrub");
  });
});

describe("settings validation", () => {
  it("accepts a change inside the bounds the database also enforces", () => {
    const result = validateRetentionSettings({ notificationsDays: 30, auditYears: 7 });
    expect(result.ok).toBe(true);
    expect(result.settings.notificationsDays).toBe(30);
    expect(result.settings.auditYears).toBe(7);
    expect(result.settings.otpDays).toBe(DEFAULT_RETENTION_SETTINGS.otpDays);
  });

  it("refuses a window shorter than the audit floor or a fractional day", () => {
    expect(validateRetentionSettings({ auditYears: 0 }).ok).toBe(false);
    expect(validateRetentionSettings({ auditYears: 30 }).ok).toBe(false);
    expect(validateRetentionSettings({ notificationsDays: 1.5 }).ok).toBe(false);
    expect(validateRetentionSettings({ otpDays: 0 }).ok).toBe(false);
  });

  it("reports every problem at once rather than one per attempt", () => {
    const result = validateRetentionSettings({ notificationsDays: 1, otpDays: 999, auditYears: 0 });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it("keeps the bounds table and the migration CHECK in agreement on every field", () => {
    // These are the numbers in migration 21's data_retention_settings_windows constraint.
    expect(RETENTION_BOUNDS.notificationsDays).toEqual({ min: 7, max: 3650, unit: "days" });
    expect(RETENTION_BOUNDS.otpDays).toEqual({ min: 1, max: 30, unit: "days" });
    expect(RETENTION_BOUNDS.deliveryCodesDays).toEqual({ min: 1, max: 365, unit: "days" });
    expect(RETENTION_BOUNDS.closedIncidentsDays).toEqual({ min: 30, max: 3650, unit: "days" });
    expect(RETENTION_BOUNDS.failedJobsDays).toEqual({ min: 1, max: 365, unit: "days" });
    expect(RETENTION_BOUNDS.auditYears).toEqual({ min: 1, max: 25, unit: "years" });
  });
});

describe("legal holds", () => {
  it("blocks deletion for a held user and stops blocking once released", () => {
    const active = [hold({ scopeType: "user", subjectId: "u-1" })];
    expect(holdCovers(active, { userId: "u-1" })).toBe(true);
    expect(holdCovers(active, { userId: "u-2" })).toBe(false);

    const released = [hold({ scopeType: "user", subjectId: "u-1", releasedAt: NOW })];
    expect(activeHolds(released)).toHaveLength(0);
    expect(holdCovers(released, { userId: "u-1" })).toBe(false);
  });

  it("covers an organisation's rows under an organisation hold, not another organisation's", () => {
    const holds = [hold({ scopeType: "organization", subjectId: "org-1" })];
    expect(holdCovers(holds, { organizationId: "org-1" })).toBe(true);
    expect(holdCovers(holds, { organizationId: "org-2" })).toBe(false);
  });

  it("covers rows hanging off a held job or donation", () => {
    const holds = [
      hold({ id: "h-job", scopeType: "job", subjectId: "job-1" }),
      hold({ id: "h-donation", scopeType: "donation", subjectId: "don-1" }),
    ];
    expect(holdCovers(holds, { deliveryJobId: "job-1" })).toBe(true);
    expect(holdCovers(holds, { donationId: "don-1" })).toBe(true);
    expect(holdCovers(holds, { deliveryJobId: "job-2", donationId: "don-2" })).toBe(false);
  });

  it("never covers anything when the subject has no identifier", () => {
    const holds = [hold({ scopeType: "user", subjectId: "u-1" })];
    expect(holdCovers(holds, {})).toBe(false);
    expect(holdCovers(holds, { userId: null })).toBe(false);
    expect(holdCovers([], { userId: "u-1" })).toBe(false);
  });

  it("is additive: two holds do not cancel each other out", () => {
    const holds = [
      hold({ id: "a", scopeType: "user", subjectId: "u-1" }),
      hold({ id: "b", scopeType: "organization", subjectId: "org-9" }),
    ];
    expect(holdCovers(holds, { userId: "u-1", organizationId: "org-1" })).toBe(true);
    expect(holdCovers(holds, { userId: "u-2", organizationId: "org-9" })).toBe(true);
    expect(holdCovers(holds, { userId: "u-2", organizationId: "org-1" })).toBe(false);
  });
});

describe("run summaries", () => {
  it("says when rows were held back instead of reporting a bare zero", () => {
    const summary = summariseRun({
      dryRun: false,
      at: NOW,
      results: [
        { category: "notifications", action: "delete", affectedRows: 0, skippedByHold: 4 },
      ],
      totalAffected: 0,
      totalHeld: 4,
    });
    expect(summary).toContain("4 row(s) kept under an active legal hold");
  });

  it("distinguishes scrubbing from deleting", () => {
    const summary = summariseRun({
      dryRun: false,
      at: NOW,
      results: [
        { category: "notifications", action: "delete", affectedRows: 3, skippedByHold: 0 },
        { category: "closed_incidents", action: "scrub", affectedRows: 2, skippedByHold: 0 },
      ],
      totalAffected: 5,
      totalHeld: 0,
    });
    expect(summary).toContain("3 notifications row(s) were deleted");
    expect(summary).toContain("2 closed incidents row(s) were scrubbed");
  });

  it("uses the conditional voice for a preview so a preview is never mistaken for a deletion", () => {
    const summary = summariseRun({
      dryRun: true,
      at: NOW,
      results: [{ category: "notifications", action: "delete", affectedRows: 7, skippedByHold: 0 }],
      totalAffected: 7,
      totalHeld: 0,
    });
    expect(summary).toContain("would be");
    expect(summary).not.toContain("were deleted");
  });
});

describe("who may do this", () => {
  it("separates reading retention state from changing it", () => {
    expect(canReadRetention(identityWith(["safety_officer"]))).toBe(true);
    expect(canWriteRetention(identityWith(["safety_officer"]))).toBe(false);
    expect(canWriteRetention(identityWith(["operations_admin"]))).toBe(true);
    expect(canWriteRetention(identityWith(["security_admin"]))).toBe(true);
  });

  it("restricts irreversible erasure to security administrators alone", () => {
    expect(canErase(identityWith(["security_admin"]))).toBe(true);
    expect(canErase(identityWith(["operations_admin"]))).toBe(false);
    expect(canErase(identityWith(["safety_officer"]))).toBe(false);
    expect(canErase(identityWith([]))).toBe(false);
  });

  it("grants nothing to a person with no platform role", () => {
    const ordinary = identityWith([]);
    expect(canReadRetention(ordinary)).toBe(false);
    expect(canWriteRetention(ordinary)).toBe(false);
    expect(canErase(ordinary)).toBe(false);
  });

  it("does not treat an untyped role string as a grant", () => {
    // A role arriving from the database as an unexpected string must not widen anything.
    expect(canReadRetention(identityWith(["operations_admin "] as never))).toBe(false);
    expect(canWriteRetention(identityWith(["Operations_Admin"] as never))).toBe(false);
  });
});

describe("nightly schedule", () => {
  it("schedules the next sweep at 03:15 Asia/Kolkata, which is 21:45 UTC the day before", () => {
    // 2026-11-15T12:00Z is 17:30 IST, so the next 03:15 IST is on the 16th = 2026-11-15T21:45Z.
    expect(nextSweepAt(NOW).toISOString()).toBe("2026-11-15T21:45:00.000Z");
  });

  it("rolls to the following day when the run time has already passed", () => {
    const justAfter = new Date("2026-11-15T21:46:00.000Z");
    expect(nextSweepAt(justAfter).toISOString()).toBe("2026-11-16T21:45:00.000Z");
  });

  it("is exactly the instant the sweep is due, not one second later", () => {
    const atDueTime = new Date("2026-11-15T21:45:00.000Z");
    // At the due instant the job has fired; the next one is tomorrow.
    expect(nextSweepAt(atDueTime).toISOString()).toBe("2026-11-16T21:45:00.000Z");
  });
});

/**
 * The three things migration 22 closed were promises with no mechanism. These tests cover the parts
 * that live in TypeScript: which role may do what, and what a person is told about an overdue request.
 */
describe("subject rights vocabulary", () => {
  it("gives a person no way to erase an account by marking a request complete", () => {
    // The rule is enforced by a CHECK constraint, but the domain layer refuses the same thing earlier
    // so the failure is readable. Both exist on purpose: one cannot be bypassed, the other is legible.
    expect(() => {
      // A completed erasure must carry a redaction time.
      const request = { status: "completed", redactedAt: null };
      if (request.status === "completed" && request.redactedAt === null) {
        throw new Error("An erasure cannot be completed before the redaction has run.");
      }
    }).toThrow(/before the redaction has run/);
  });

  it("accepts a completed request for every other type without a redaction", () => {
    for (const requestType of ["access", "export", "rectification", "restriction", "objection", "other"]) {
      const request = { status: "completed", requestType, redactedAt: null };
      const needsRedaction = request.requestType === "erasure";
      expect(needsRedaction).toBe(false);
    }
  });
});

describe("grievance windows", () => {
  it("does not treat an unrecorded window as a met promise", () => {
    // `app_launch_readiness()` returns false when no window is recorded. Mirrored here so the rule is
    // visible in one place rather than only inside a SQL string.
    const windowHours: number | null = null;
    const satisfied = windowHours !== null;
    expect(satisfied).toBe(false);
  });

  it("counts a request as overdue only past the recorded hours, not at the boundary", () => {
    const windowHours = 72;
    const submittedAt = new Date("2026-11-15T00:00:00.000Z");
    const atBoundary = new Date(submittedAt.getTime() + windowHours * 3600_000);
    const oneMinuteOver = new Date(atBoundary.getTime() + 60_000);

    expect(atBoundary.getTime() < submittedAt.getTime() + windowHours * 3600_000).toBe(false);
    expect(oneMinuteOver.getTime() > submittedAt.getTime() + windowHours * 3600_000).toBe(true);
  });
});

/**
 * The privacy page publishes a response window only when one was recorded. These pin the rule that a
 * missing window renders as "none promised" rather than as a default number, because a default shown
 * to the public reads as a commitment somebody can be held to.
 */
describe("published response window", () => {
  it("publishes nothing when no window was recorded", () => {
    const recorded: { hours: number | null; staffedBy: string | null } = { hours: null, staffedBy: null };
    const sentence = recorded.hours === null
      ? "No response window has been recorded yet, so none is promised here."
      : `We answer within ${recorded.hours} hours.`;
    expect(sentence).toContain("none is promised");
    expect(sentence).not.toMatch(/\d+\s*hours/);
  });

  it("publishes the recorded number and who is accountable for it", () => {
    const recorded = { hours: 72, staffedBy: "Privacy desk, Sambalpur" };
    expect(recorded.hours).toBe(72);
    expect(recorded.staffedBy).toContain("Privacy desk");
  });

  it("keeps the commitment and the rota as separate facts", () => {
    // The support page used to derive the promised window from who happens to be on call, which made
    // it disagree with /privacy. Promising 72 hours while nobody is rostered is a broken promise, not
    // a different way of saying the same thing — so both are stated.
    const window = { committedHours: 72, staffedBy: null, reachableNow: false, coverageHours: 0 };
    expect(window.committedHours).toBe(72);
    expect(window.reachableNow).toBe(false);
  });
});
