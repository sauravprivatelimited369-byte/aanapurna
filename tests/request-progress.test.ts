import { describe, expect, it } from "vitest";
import { buildRequestProgress, requestTypeLabel, type RequestAuditRow } from "@/domain/request-progress";

const now = new Date("2026-11-15T12:00:00.000Z");

function progress(overrides: Partial<Parameters<typeof buildRequestProgress>[0]> = {}) {
  return buildRequestProgress({
    requestType: "erasure",
    status: "submitted",
    createdAt: "2026-11-15T06:00:00.000Z",
    resolution: null,
    completedAt: null,
    redactedAt: null,
    audit: [],
    windowHours: 72,
    aheadInQueue: null,
    now,
    ...overrides,
  });
}

describe("request progress", () => {
  it("opens with the submission and nothing else", () => {
    const result = progress();
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]?.key).toBe("submitted");
    expect(result.stages[0]?.current).toBe(true);
    expect(result.ageHours).toBe(6);
  });

  it("never shows a stage that did not happen", () => {
    // A timeline padded with future steps reads as progress. This is the rule that stops it.
    const result = progress();
    const keys = result.stages.map((stage) => stage.key);
    expect(keys).not.toContain("in_review");
    expect(keys).not.toContain("decided");
    expect(keys).not.toContain("redacted");
  });

  it("adds a review stage once somebody picks it up", () => {
    const audit: RequestAuditRow[] = [{
      action: "privacy.data_request_updated",
      createdAt: "2026-11-15T07:00:00.000Z",
      details: { fromStatus: "submitted", toStatus: "in_review" },
    }];
    const result = progress({ status: "in_review", audit });
    expect(result.stages.map((stage) => stage.key)).toEqual(["submitted", "in_review"]);
    expect(result.stages.at(-1)?.current).toBe(true);
  });

  it("marks waiting on the person as a pause, not as progress", () => {
    const audit: RequestAuditRow[] = [{
      action: "privacy.data_request_updated",
      createdAt: "2026-11-15T07:00:00.000Z",
      details: { toStatus: "awaiting_user" },
    }];
    const result = progress({ status: "awaiting_user", audit });
    expect(result.stages.map((stage) => stage.key)).toContain("awaiting_you");
    expect(result.nextStep).toMatch(/reply/i);
  });

  it("does not duplicate a decision that is already in the audit trail", () => {
    // The audit row for the decision and the request's own status column say the same thing. Showing
    // both would look like two decisions were recorded.
    const audit: RequestAuditRow[] = [
      { action: "privacy.data_request_updated", createdAt: "2026-11-15T07:00:00.000Z", details: { toStatus: "in_review" } },
      { action: "privacy.data_request_updated", createdAt: "2026-11-15T09:00:00.000Z", details: { toStatus: "completed" } },
    ];
    const result = progress({
      status: "completed", audit, completedAt: "2026-11-15T09:00:00.000Z", resolution: "Done.",
    });
    expect(result.stages.filter((stage) => stage.key === "decided")).toHaveLength(1);
    expect(result.stages.filter((stage) => stage.key === "in_review")).toHaveLength(1);
  });

  it("records the redaction as its own step for an erasure", () => {
    const result = progress({
      status: "completed",
      completedAt: "2026-11-15T09:00:00.000Z",
      redactedAt: "2026-11-15T09:00:00.000Z",
      resolution: "Erased.",
    });
    const redacted = result.stages.find((stage) => stage.key === "redacted");
    expect(redacted).toBeDefined();
    expect(redacted?.detail).toContain("Receipts");
  });

  it("survives a scrubbed audit row rather than crashing on it", () => {
    // Retention replaces `details` with {} after six years. The timeline must keep working.
    const result = progress({
      status: "in_review",
      audit: [{ action: "privacy.data_request_updated", createdAt: "2026-11-15T07:00:00.000Z", details: {} }],
    });
    expect(result.stages.length).toBeGreaterThanOrEqual(1);
  });

  describe("the promise it makes about time", () => {
    it("says unknown, not on-time, when no window is recorded", () => {
      const result = progress({ windowHours: null });
      expect(result.overdue).toBeNull();
      expect(result.nextStep).toMatch(/No response window/i);
      expect(result.nextStep).not.toMatch(/\d+\s*hour/);
    });

    it("is inside the window at the boundary and overdue one hour later", () => {
      // Boundary belongs to the person: 72 hours means 72 hours, not 71. `now` is 12:00 on the 15th.
      expect(progress({ windowHours: 72 }).overdue).toBe(false);
      // Exactly 72 hours old.
      expect(progress({ windowHours: 72, createdAt: "2026-11-12T12:00:00.000Z" }).overdue).toBe(false);
      // One hour past it.
      expect(progress({ windowHours: 72, createdAt: "2026-11-12T11:00:00.000Z" }).overdue).toBe(true);
    });

    it("tells an overdue person they may say so", () => {
      const result = progress({ windowHours: 2 });
      expect(result.overdue).toBe(true);
      expect(result.nextStep).toMatch(/entitled/i);
    });

    it("counts down in hours while there is time left", () => {
      const result = progress({ windowHours: 10 });
      expect(result.nextStep).toContain("4 hours");
    });
  });

  it("names the request type in a sentence a person would use", () => {
    expect(requestTypeLabel("erasure")).toBe("erasure");
    expect(requestTypeLabel("rectification")).toBe("a correction");
    expect(requestTypeLabel("who_knows")).toBe("a privacy request");
    expect(progress().stages[0]?.label).toContain("erasure");
  });
});
