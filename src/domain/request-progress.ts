/**
 * Where a request actually is, in words a person can act on.
 *
 * The support page showed a status pill — `in_review` — which names an internal state and says
 * nothing else. It does not say whether anyone picked it up, how long it has been sitting, what the
 * next step is, or who is answerable now. This builds that from the audit trail, which is the only
 * honest source: each transition was written when it happened, so the timeline is a record rather
 * than a story reconstructed from the current status.
 *
 * Deliberately not exposed: `assignedTo` and `reviewedBy` as raw user ids. A person is told that a
 * reviewer has the request and when it moved, not which member of staff it is — that is somebody
 * else's personal data, and naming staff in a customer view invites retaliation.
 *
 * A stage appears only if it happened. No greyed-out future steps, because a timeline showing events
 * that have not occurred reads as reassurance and is indistinguishable from a lie.
 */

export type RequestStageKey = "submitted" | "in_review" | "awaiting_you" | "decided" | "redacted";

export type RequestStage = {
  /** Stable key so the UI styles and tests assert without parsing prose. */
  key: RequestStageKey;
  at: string;
  /** What happened, in the second person. */
  label: string;
  /** What it means for them, or null when there is nothing to add. */
  detail: string | null;
  /** True for the stage the request currently sits at. */
  current: boolean;
};

export type RequestProgress = {
  requestType: string;
  status: string;
  createdAt: string;
  /** Hours since submission, rounded down. Computed on the server so the view cannot drift. */
  ageHours: number;
  /**
   * The promised window, or null when nobody recorded one. Never a default: a number here is a
   * commitment, and inventing one makes the product lie about its own service level.
   */
  windowHours: number | null;
  /** Null when no window is recorded — "unknown" is not the same as "on time". */
  overdue: boolean | null;
  /** How many open requests were submitted before this one. Null when not computed. */
  aheadInQueue: number | null;
  stages: RequestStage[];
  /** What happens next, plainly. Always present. */
  nextStep: string;
};

const TYPE_LABEL: Record<string, string> = {
  access: "a copy of the information held about you",
  export: "a portable copy of your data",
  rectification: "a correction",
  erasure: "erasure",
  restriction: "a restriction on how your data is used",
  objection: "an objection",
  other: "a privacy request",
};

export function requestTypeLabel(requestType: string): string {
  return TYPE_LABEL[requestType] ?? "a privacy request";
}

/** The shape the audit reader returns. `details` is jsonb and may have been scrubbed to {}. */
export type RequestAuditRow = {
  action: string;
  createdAt: string | Date;
  details: unknown;
};

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function targetStatus(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const value = (details as { toStatus?: unknown }).toStatus;
  return typeof value === "string" ? value : null;
}

/**
 * Fold the audit trail into a progress view. Pure, so the wording and the stage rules are testable
 * without a database, and so a person's view and a staff view cannot drift apart.
 */
export function buildRequestProgress(input: {
  requestType: string;
  status: string;
  createdAt: string;
  resolution: string | null;
  completedAt: string | null;
  redactedAt: string | null;
  audit: RequestAuditRow[];
  windowHours: number | null;
  aheadInQueue: number | null;
  now: Date;
}): RequestProgress {
  const created = new Date(input.createdAt);
  const ageHours = Math.max(0, Math.floor((input.now.getTime() - created.getTime()) / 3_600_000));
  const overdue = input.windowHours === null ? null : ageHours > input.windowHours;

  const stages: RequestStage[] = [{
    key: "submitted",
    at: created.toISOString(),
    label: `You asked for ${requestTypeLabel(input.requestType)}.`,
    detail: "Recorded. Nothing has happened to your data yet.",
    current: false,
  }];

  const seen = new Set<RequestStageKey>(["submitted"]);
  const ordered = [...input.audit].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const row of ordered) {
    if (row.action === "privacy.data_request_updated") {
      const to = targetStatus(row.details);
      // A decision is rendered once at the end from the request's own columns, so the audit row for
      // it would be a duplicate. Skip it here rather than showing the same fact twice.
      if (to === "completed" || to === "rejected") continue;
      if (to === "awaiting_user" && !seen.has("awaiting_you")) {
        seen.add("awaiting_you");
        stages.push({
          key: "awaiting_you",
          at: toIso(row.createdAt),
          label: "The reviewer asked you something.",
          detail: "Your request is paused until you reply. It has not been decided.",
          current: false,
        });
      } else if (!seen.has("in_review")) {
        seen.add("in_review");
        stages.push({
          key: "in_review",
          at: toIso(row.createdAt),
          label: "Somebody picked your request up and is working on it.",
          detail: to === "in_review" ? "A named reviewer is answerable for it." : null,
          current: false,
        });
      }
    }
  }

  if (input.redactedAt) {
    seen.add("redacted");
    stages.push({
      key: "redacted",
      at: new Date(input.redactedAt).toISOString(),
      label: "Your identifying details were overwritten.",
      detail: "Name, email and sign-in methods are gone. Receipts and the audit trail remain, because they answer for the food.",
      current: false,
    });
  }

  const decided = input.status === "completed" || input.status === "rejected";
  if (decided) {
    stages.push({
      key: "decided",
      at: input.completedAt ? new Date(input.completedAt).toISOString() : created.toISOString(),
      label: input.status === "completed" ? "A decision was recorded." : "The request was declined.",
      detail: input.resolution ?? "No explanation was written against this decision.",
      current: true,
    });
  } else {
    // Mark the last non-decision stage as where it currently sits.
    const last = stages[stages.length - 1];
    if (last) last.current = true;
  }

  const nextStep = decided
    ? input.status === "completed"
      ? "Nothing further is needed from you. You can get a copy of your data at any time from your profile page."
      : "If you disagree, you can raise a new request and refer to this one. Nothing else is needed from you."
    : input.status === "awaiting_user"
      ? "Reply to the reviewer's question. The clock waits while it is with you."
      : input.windowHours === null
        ? "No response window has been recorded, so no date is promised. A reviewer still has to decide it, and it stays open until they do."
        : overdue === true
          ? `This is ${ageHours - input.windowHours} hours past the ${input.windowHours}-hour window, and is counted as overdue on the operations screen. You do not have to do anything, but you are entitled to point at this.`
          : `A reviewer should decide within ${input.windowHours} hours of when you asked, which is ${input.windowHours - ageHours} hours away.`;

  return {
    requestType: input.requestType,
    status: input.status,
    createdAt: created.toISOString(),
    ageHours,
    windowHours: input.windowHours,
    overdue,
    aheadInQueue: input.aheadInQueue,
    stages,
    nextStep,
  };
}
