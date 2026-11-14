/**
 * Sample workspace for the public walkthrough at /preview.
 *
 * This module is a fixed, checked-in sample. It never reads the database, never
 * writes anything, and is never used by a real workflow: the operational pages
 * under /app and every /api route read from PostgreSQL through src/domain. The
 * single purpose of this data is to let someone who has not signed in see what
 * the product records at each step of a handover.
 *
 * Rules this file must keep:
 * - every organisation, person and reference is explicitly fictional;
 * - contact details use reserved example domains, never a real address or phone;
 * - no delivery verification code value appears here at all, only its shape;
 * - the numbers are labelled as a sample, not as impact.
 */

export const DEMO_WORKSPACE_NOTICE =
  "Sample walkthrough. Every organisation, person and reference below is fictional. Nothing here is a real donation, partner, delivery or impact figure.";

export type DemoOrganization = {
  id: string;
  displayName: string;
  type: "generator" | "receiver";
  status: "verified" | "pending";
  area: string;
  contact: string;
};

export type DemoListing = {
  reference: string;
  name: string;
  category: string;
  foodType: "vegetarian" | "non_vegetarian" | "mixed";
  quantity: number;
  unit: string;
  allergens: string[];
  ingredients: string;
  preparedAt: string;
  packedAt: string;
  bestBeforeAt: string;
  pickupFrom: string;
  pickupUntil: string;
  storage: string;
  handling: string;
  notes: string;
};

export type DemoOffer = {
  responder: string;
  responseWindowMinutes: number;
  acceptedQuantity: number;
  acceptedUnit: string;
  decision: "accepted";
  reason: string;
};

export type DemoDispatch = {
  jobReference: string;
  candidates: Array<{ helper: string; result: "claimed" | "conflict" }>;
  releasedBy: string;
  releaseReason: string;
};

export type DemoCustodyEvent = {
  at: string;
  actor: string;
  actorRole: "generator" | "receiver" | "helper" | "system";
  event: string;
  detail: string;
};

export type DemoReceipt = {
  reference: string;
  quantity: number;
  unit: string;
  collectedAt: string;
  deliveredAt: string;
  verified: true;
  confirmedBy: string;
};

export type DemoWorkspace = {
  isDemoData: true;
  serviceArea: { name: string; timeZone: string; policyVersion: string; policyStatus: "draft" | "approved" };
  organizations: DemoOrganization[];
  listing: DemoListing;
  offer: DemoOffer;
  dispatch: DemoDispatch;
  custody: DemoCustodyEvent[];
  verification: {
    format: string;
    attemptLimit: number;
    visibleTo: string;
    neverVisibleTo: string[];
    maskedExample: string;
    resetPath: string;
  };
  receipt: DemoReceipt;
  sample: {
    verifiedDeliveries: number;
    verifiedPortions: number;
    caption: string;
  };
  guestLimits: string[];
};

export const DEMO_WORKSPACE: DemoWorkspace = {
  isDemoData: true,
  serviceArea: {
    name: "Joka · IIM Calcutta (Kolkata)",
    timeZone: "Asia/Kolkata",
    policyVersion: "0.1.0-iim-calcutta",
    policyStatus: "draft",
  },
  organizations: [
    {
      id: "demo-org-generator",
      displayName: "Sample Canteen (fictional)",
      type: "generator",
      status: "verified",
      area: "Joka, Kolkata",
      contact: "canteen@example.org",
    },
    {
      id: "demo-org-receiver",
      displayName: "Sample Shelter Kitchen (fictional)",
      type: "receiver",
      status: "verified",
      area: "Joka, Kolkata",
      contact: "kitchen@example.org",
    },
  ],
  listing: {
    reference: "DEMO-LST-0001",
    name: "Vegetable pulao and dal",
    category: "Freshly cooked vegetarian meals",
    foodType: "vegetarian",
    quantity: 40,
    unit: "portions",
    allergens: ["milk"],
    ingredients: "Rice, seasonal vegetables, lentils, ghee, salt, spices",
    preparedAt: "2026-03-04T07:10:00+05:30",
    packedAt: "2026-03-04T07:40:00+05:30",
    bestBeforeAt: "2026-03-04T13:00:00+05:30",
    pickupFrom: "2026-03-04T09:00:00+05:30",
    pickupUntil: "2026-03-04T11:00:00+05:30",
    storage: "Held above 60°C in covered steel trays until handover",
    handling: "Keep covered and upright. Do not stack trays. Reheat only to serving temperature at the Receiver kitchen.",
    notes: "Prepared for a cancelled department lunch. Never left unrefrigerated after packing.",
  },
  offer: {
    responder: "Sample Shelter Kitchen (fictional)",
    responseWindowMinutes: 30,
    acceptedQuantity: 36,
    acceptedUnit: "portions",
    decision: "accepted",
    reason: "Capacity for 36 portions at the evening service; 4 portions stayed with the Generator under the partial-acceptance rule.",
  },
  dispatch: {
    jobReference: "DEMO-JOB-0001",
    candidates: [
      { helper: "Sample Helper A (fictional)", result: "claimed" },
      { helper: "Sample Helper B (fictional)", result: "conflict" },
    ],
    releasedBy: "Sample Helper C (fictional)",
    releaseReason: "Flat tyre before leaving home; released the job before collection so operations could reassign it.",
  },
  custody: [
    {
      at: "2026-03-04T07:40:00+05:30",
      actor: "Sample Canteen (fictional)",
      actorRole: "generator",
      event: "Listing submitted",
      detail: "40 portions declared, allergens and handling instructions recorded, policy version 0.1.0-iim-calcutta attached.",
    },
    {
      at: "2026-03-04T08:05:00+05:30",
      actor: "Sample Shelter Kitchen (fictional)",
      actorRole: "receiver",
      event: "Offer accepted (partial)",
      detail: "36 of 40 portions accepted inside the 30-minute response window, with a stated reason.",
    },
    {
      at: "2026-03-04T08:12:00+05:30",
      actor: "Sample Helper A (fictional)",
      actorRole: "helper",
      event: "Job claimed",
      detail: "One conditional database update claimed the job. A second Helper attempting the same job was told it was already taken.",
    },
    {
      at: "2026-03-04T09:24:00+05:30",
      actor: "Sample Helper A (fictional)",
      actorRole: "helper",
      event: "Collection confirmed",
      detail: "Trays counted at 9, packaging intact, no temperature issue reported. Generator staff present at handover.",
    },
    {
      at: "2026-03-04T10:02:00+05:30",
      actor: "Sample Helper A (fictional)",
      actorRole: "helper",
      event: "Arrival recorded",
      detail: "Helper recorded physical arrival at the Receiver kitchen; the food was inspected before any code was shared.",
    },
    {
      at: "2026-03-04T10:09:00+05:30",
      actor: "Sample Shelter Kitchen (fictional)",
      actorRole: "receiver",
      event: "Delivery verified",
      detail: "Receiver shared the single-use code after inspection. The code was consumed, one receipt was created and the counts moved once.",
    },
  ],
  verification: {
    format: "Six digits, generated on the server, valid once and only for the active delivery",
    attemptLimit: 5,
    visibleTo: "The Receiver organisation linked to that one active delivery, and only after arrival is recorded",
    neverVisibleTo: ["The Helper who has to submit it", "The Generator", "Support agents", "Any API response, notification, log or error message"],
    maskedExample: "••••••",
    resetPath: "After five failed attempts the delivery locks and only an audited operations reset can reissue a code; the exception is recorded against the delivery.",
  },
  receipt: {
    reference: "DEMO-RCPT-0001",
    quantity: 36,
    unit: "portions",
    collectedAt: "2026-03-04T09:24:00+05:30",
    deliveredAt: "2026-03-04T10:09:00+05:30",
    verified: true,
    confirmedBy: "Sample Shelter Kitchen (fictional)",
  },
  sample: {
    verifiedDeliveries: 1,
    verifiedPortions: 36,
    caption: "Sample arithmetic for this one walkthrough only. It is not an impact claim and is never counted with real records.",
  },
  guestLimits: [
    "Nothing on this page is stored, and no action here changes any record.",
    "Creating a listing, accepting an offer, claiming a job and confirming delivery all require a signed-in, approved account.",
    "Guest access never shows a delivery code, never shows another organisation's documents, and never reaches the operations console.",
  ],
};

/**
 * Invariants the walkthrough must satisfy. Exported so the test suite can hold
 * this page to the same rules as production data.
 */
export function demoWorkspaceProblems(workspace: DemoWorkspace = DEMO_WORKSPACE): string[] {
  const problems: string[] = [];
  if (workspace.isDemoData !== true) problems.push("demo data must be flagged as demo data");

  const { listing, offer, receipt, dispatch } = workspace;
  if (!(listing.quantity > 0)) problems.push("listing quantity must be positive");
  if (!(offer.acceptedQuantity > 0)) problems.push("accepted quantity must be positive");
  if (offer.acceptedQuantity > listing.quantity) problems.push("accepted quantity cannot exceed the offered quantity");
  if (offer.acceptedUnit !== listing.unit) problems.push("accepted unit must match the offered unit");
  if (!(receipt.quantity > 0)) problems.push("receipt quantity must be positive");
  if (receipt.quantity > offer.acceptedQuantity) problems.push("receipt quantity cannot exceed what the Receiver accepted");
  if (new Date(listing.bestBeforeAt).getTime() <= new Date(listing.preparedAt).getTime()) problems.push("best-before must follow preparation");
  if (new Date(listing.pickupUntil).getTime() <= new Date(listing.pickupFrom).getTime()) problems.push("pickup window must end after it starts");
  if (new Date(receipt.collectedAt).getTime() < new Date(listing.pickupFrom).getTime()) problems.push("collection cannot precede the pickup window");
  if (new Date(receipt.deliveredAt).getTime() <= new Date(receipt.collectedAt).getTime()) problems.push("delivery must follow collection");

  const ascending = workspace.custody.every((event, index) => index === 0
    || new Date(event.at).getTime() >= new Date(workspace.custody[index - 1].at).getTime());
  if (!ascending) problems.push("custody events must be ordered oldest first");

  const claimed = dispatch.candidates.filter((candidate) => candidate.result === "claimed").length;
  if (claimed !== 1) problems.push("exactly one Helper may hold a job");

  const references = [listing.reference, dispatch.jobReference, receipt.reference];
  if (new Set(references).size !== references.length) problems.push("each record needs its own reference");

  const contacts = workspace.organizations.map((organization) => organization.contact);
  if (contacts.some((contact) => !contact.endsWith("@example.org"))) problems.push("sample contacts must use the reserved example.org domain");

  const serialised = JSON.stringify(workspace);
  if (/\d{6}/.test(workspace.verification.maskedExample)) problems.push("no verification code value may be present");
  if (/\+?\d[\d ]{8,}/.test(serialised)) problems.push("no phone-number-like sequence may be present");

  return problems;
}
