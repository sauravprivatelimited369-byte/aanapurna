/**
 * Launch readiness.
 *
 * Five of the register's gaps cannot be closed by code: a legal entity, insurance, a named
 * data-protection contact, a staffed rota and an independent penetration test need a person to act.
 * What code can do is refuse to pretend. This module turns each one into a checkable fact with an
 * owner, an expiry and a named action, so "somebody will handle it" shows up as red on a screen
 * instead of living in a paragraph nobody reads.
 *
 * Email delivery and malware scanning are included because they are the two remaining requirements
 * that depend on a value only the owner can supply.
 */

export type ReadinessKey =
  | "legal_entity"
  | "insurance"
  | "data_protection_contact"
  | "on_call"
  | "penetration_test"
  | "email_delivery"
  | "malware_scanner"
  | "partner_insurance"
  | "partner_agreement";

export type ReadinessItem = {
  key: ReadinessKey;
  label: string;
  satisfied: boolean;
  detail: string;
  ownerAction: string;
  expiresAt: string | null;
};

export type AttestationRecord = {
  key: string;
  label: string;
  value: Record<string, unknown>;
  evidenceReference: string | null;
  recordedBy: string | null;
  recordedAt: string;
  expiresAt: string | null;
};

export type OnCallShift = { userId: string; startsAt: string; endsAt: string; channel: string };

export type ReadinessInput = {
  now: Date;
  /**
   * Booleans from `app_launch_readiness()`. When present they are authoritative for the five owner
   * declarations, which lets a public endpoint report readiness without reading the values.
   */
  declared?: Partial<Record<
    "legal_entity" | "insurance" | "data_protection_contact" | "on_call" | "penetration_test" | "partner_insurance" | "partner_agreement",
    boolean
  >>;
  attestations: AttestationRecord[];
  onCallShifts: OnCallShift[];
  email: { configured: boolean; testSink: boolean; localOnly: boolean; missingSettings: string[] };
  scanner: { mode: string; hostConfigured: boolean };
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function find(attestations: AttestationRecord[], key: ReadinessKey): AttestationRecord | undefined {
  return attestations.find((record) => record.key === key);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** The owner actions are written as instructions, not as complaints. */
export const OWNER_ACTIONS: Record<ReadinessKey, string> = {
  legal_entity:
    "Register the entity (or decide on one), then record its name, jurisdiction, address and registration reference here. A named person answers for the service.",
  insurance:
    "Buy cover, then record the insurer, policy reference and expiry. Renew before the expiry date or the check fails again on its own.",
  data_protection_contact:
    "Name the person who answers personal-data questions, with a working address and the hours they are reachable. It is published on the privacy page once recorded.",
  on_call:
    "Schedule a named person covering the next 24 hours. Without a shift the product says nobody is on call, because nobody is.",
  penetration_test:
    "Commission an independent test, then record the provider, report reference and date. It must be less than twelve months old.",
  email_delivery:
    "Set SMTP_URL (or SMTP_HOST/PORT/USER/PASS) to a real provider. A capture sink or a loopback mailbox does not count.",
  malware_scanner:
    "Set FILE_SCAN_MODE=clamav and CLAMAV_HOST/CLAMAV_PORT to a reachable clamd. Uploads stay blocked until then, by design.",
  partner_insurance:
    "Every verified partner records its own policy reference and expiry from Its organisation page. Until each one is current, the answer to \"who is covered if someone is harmed\" is nobody.",
  partner_agreement:
    "A named member of every verified partner accepts the current responsibility agreement. When the agreement text changes, each partner is asked again rather than silently grandfathered.",
};

export function evaluateReadiness(input: ReadinessInput): { items: ReadinessItem[]; complete: boolean; missing: ReadinessKey[] } {
  const { now, attestations, onCallShifts, email, scanner } = input;

  const legalEntity = find(attestations, "legal_entity");
  const entityName = text(legalEntity?.value.entityName);
  const jurisdiction = text(legalEntity?.value.jurisdiction);

  const insurance = find(attestations, "insurance");
  const policyReference = text(insurance?.value.policyReference);
  const insuranceExpiry = insurance?.expiresAt ? new Date(insurance.expiresAt) : null;
  const insuranceValid = Boolean(
    policyReference && insuranceExpiry && insuranceExpiry.getTime() > now.getTime(),
  );

  const dpo = find(attestations, "data_protection_contact");
  const contactName = text(dpo?.value.contactName);
  const contactEmail = text(dpo?.value.contactEmail);

  const pentest = find(attestations, "penetration_test");
  const reportReference = text(pentest?.value.reportReference);
  const completedOn = text(pentest?.value.completedOn);
  const completedAt = completedOn ? new Date(completedOn) : null;
  const pentestFresh = Boolean(
    reportReference && completedAt && !Number.isNaN(completedAt.getTime()) && daysBetween(completedAt, now) <= 365,
  );

  const covering = onCallShifts.find((shift) => {
    const start = new Date(shift.startsAt).getTime();
    const end = new Date(shift.endsAt).getTime();
    const at = now.getTime();
    return start <= at && end > at;
  });
  const coverageAhead = onCallShifts.some((shift) => {
    const end = new Date(shift.endsAt).getTime();
    return end > now.getTime() && end - now.getTime() >= 86_400_000 / 2;
  });

  const items: ReadinessItem[] = [
    {
      key: "legal_entity",
      label: "Legal entity",
      satisfied: Boolean(entityName && jurisdiction),
      detail: entityName && jurisdiction
        ? `${entityName} · ${jurisdiction}`
        : "No entity is recorded, so nobody is named as answerable for the service.",
      ownerAction: OWNER_ACTIONS.legal_entity,
      expiresAt: null,
    },
    {
      key: "insurance",
      label: "Insurance",
      satisfied: insuranceValid,
      detail: insuranceValid
        ? `${policyReference} until ${insuranceExpiry?.toISOString().slice(0, 10)}`
        : policyReference
          ? "A policy is recorded but it has expired or has no expiry date."
          : "No insurance policy is recorded.",
      ownerAction: OWNER_ACTIONS.insurance,
      expiresAt: insurance?.expiresAt ?? null,
    },
    {
      key: "data_protection_contact",
      label: "Data-protection contact",
      satisfied: Boolean(contactName && contactEmail),
      detail: contactName && contactEmail
        ? `${contactName} · ${contactEmail}`
        : "No one is named as the contact for personal-data questions.",
      ownerAction: OWNER_ACTIONS.data_protection_contact,
      expiresAt: null,
    },
    {
      key: "on_call",
      label: "On-call coverage",
      satisfied: Boolean(covering) && coverageAhead,
      detail: covering
        ? `Covered now · ${covering.channel}`
        : onCallShifts.length > 0
          ? "Shifts exist, but none covers the current time."
          : "Nobody is on call. A breach noticed tonight would reach no one.",
      ownerAction: OWNER_ACTIONS.on_call,
      expiresAt: covering?.endsAt ?? null,
    },
    {
      key: "penetration_test",
      label: "Independent penetration test",
      satisfied: pentestFresh,
      detail: pentestFresh
        ? `${reportReference} · ${completedOn}`
        : "No independent test is recorded within the last twelve months.",
      ownerAction: OWNER_ACTIONS.penetration_test,
      expiresAt: pentest?.expiresAt ?? null,
    },
    {
      key: "partner_insurance",
      label: "Partner insurance declared",
      satisfied: input.declared?.partner_insurance ?? false,
      detail: input.declared?.partner_insurance
        ? "Every verified partner holds a current insurance declaration."
        : "At least one verified partner has no current insurance declaration on record, so the answer to \"who is covered\" is incomplete.",
      ownerAction: OWNER_ACTIONS.partner_insurance,
      expiresAt: null,
    },
    {
      key: "partner_agreement",
      label: "Partner agreement accepted",
      satisfied: input.declared?.partner_agreement ?? false,
      detail: input.declared?.partner_agreement
        ? "Every verified partner has accepted the current responsibility agreement."
        : "At least one verified partner has not accepted the current agreement version.",
      ownerAction: OWNER_ACTIONS.partner_agreement,
      expiresAt: null,
    },
    {
      key: "email_delivery",
      label: "Email delivery",
      satisfied: email.configured && !email.testSink && !email.localOnly,
      detail: !email.configured
        ? `Not configured${email.missingSettings.length ? ` (missing: ${email.missingSettings.join(", ")})` : ""}.`
        : email.testSink || email.localOnly
          ? "Configured, but pointed at a capture sink or a loopback mailbox: nothing reaches a person."
          : "Configured with a provider.",
      ownerAction: OWNER_ACTIONS.email_delivery,
      expiresAt: null,
    },
    {
      key: "malware_scanner",
      label: "Malware scanning",
      satisfied: scanner.mode === "clamav" && scanner.hostConfigured,
      detail: scanner.mode === "clamav"
        ? scanner.hostConfigured ? "Configured." : "Mode is clamav but no scanner host is set."
        : "No scanner is configured, so private document uploads are refused.",
      ownerAction: OWNER_ACTIONS.malware_scanner,
      expiresAt: null,
    },
  ];

  // Declared booleans win: they are what the database gate itself will use, and a public endpoint
  // must not disagree with the gate it reports on.
  const gated = items.map((item) => {
    const override = input.declared?.[item.key as keyof NonNullable<ReadinessInput["declared"]>];
    if (override === undefined) return item;
    return {
      ...item,
      satisfied: override,
      detail: override
        ? item.satisfied ? item.detail : "Recorded and current."
        : item.satisfied ? "The launch gate rejects this record; check its expiry." : item.detail,
    };
  });

  const missing = gated.filter((item) => !item.satisfied).map((item) => item.key);
  return { items: gated, complete: missing.length === 0, missing };
}
