import { z } from "zod";

const safeText = (max: number) => z.string().trim().min(1).max(max);

/** Public registration roles only. Admin is never accepted from a browser. */
export const publicRegistrationRoles = ["generator", "receiver", "helper"] as const;
export const organisationTypes = ["generator", "receiver"] as const;

const weakPasswords = new Set([
  "annapurna123456", "password123456", "password12345!", "qwerty1234567",
  "1234567890123456", "welcome1234567", "letmein1234567", "administrator123",
]);

function passwordIssue(password: string): string | null {
  if (password.length < 12 || password.length > 128) return "Use a password between 12 and 128 characters.";
  const categories = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (categories < 3) return "Mix upper-case letters, lower-case letters, numbers and symbols (at least three kinds).";
  if (/(.)\1{5,}/.test(password)) return "Avoid long runs of the same character.";
  if (weakPasswords.has(password.toLowerCase())) return "Choose a less common password.";
  return null;
}

function refineRegistrationDetails(value: {
  role: string;
  organizationName?: string | null;
  organizationType?: string | null;
  addressLine: string;
  cityOrDistrict: string;
  profileNotes: string;
}, context: z.RefinementCtx): void {
  const isOrganisation = value.role === "generator" || value.role === "receiver";
  if (isOrganisation && (!value.organizationName || value.organizationName.trim().length < 2)) {
    context.addIssue({ code: "custom", path: ["organizationName"], message: "Enter your organisation's registered name." });
  }
  if (isOrganisation && value.organizationType !== value.role) {
    context.addIssue({ code: "custom", path: ["organizationType"], message: "Organisation type must match the role you selected." });
  }
  if (!isOrganisation && value.organizationName?.trim()) {
    context.addIssue({ code: "custom", path: ["organizationName"], message: "Helpers register as individuals; leave the organisation name empty." });
  }
  if (!isOrganisation && value.organizationType) {
    context.addIssue({ code: "custom", path: ["organizationType"], message: "Helpers register as individuals; leave the organisation type empty." });
  }
  if (value.addressLine.trim().length < 5) {
    context.addIssue({ code: "custom", path: ["addressLine"], message: "Enter a complete street address." });
  }
  if (value.cityOrDistrict.trim().length < 2) {
    context.addIssue({ code: "custom", path: ["cityOrDistrict"], message: "Enter your city, district or operating area." });
  }
  if (value.profileNotes.trim().length < 10) {
    context.addIssue({ code: "custom", path: ["profileNotes"], message: "Add a short description of your work or availability (at least 10 characters)." });
  }
}

const registrationDetailsFields = {
  role: z.enum(publicRegistrationRoles),
  phone: z.string().trim().min(7).max(32).regex(/^[+0-9 ()-]+$/, "Use digits, spaces, +, ( ) and - only."),
  organizationName: z.string().trim().max(160).optional().nullable(),
  organizationType: z.enum(organisationTypes).optional().nullable(),
  addressLine: z.string().trim().min(5).max(500),
  cityOrDistrict: z.string().trim().min(2).max(120),
  stateOrRegion: z.string().trim().max(120).optional().default(""),
  postalCode: z.string().trim().max(20).optional().default(""),
  profileNotes: z.string().trim().min(10).max(1_000),
};

/**
 * Server-side validation of the profile fields Better Auth receives as extra
 * user fields. Extra Better Auth internal keys are ignored here; the public
 * `/api/register` route uses the strict `registrationSchema` instead.
 */
export const registrationDetailsSchema = z.object(registrationDetailsFields).superRefine(refineRegistrationDetails);

/** Full public registration request. `.strict()` blocks privileged fields such as roles or status. */
export const registrationSchema = z.object({
  ...registrationDetailsFields,
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  password: z.string().min(12).max(128),
  acceptedTerms: z.literal(true),
}).strict().superRefine((value, context) => {
  refineRegistrationDetails(value, context);
  const issue = passwordIssue(value.password);
  if (issue) context.addIssue({ code: "custom", path: ["password"], message: issue });
  const localPart = value.email.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length > 3 && value.password.toLowerCase().includes(localPart)) {
    context.addIssue({ code: "custom", path: ["password"], message: "Do not include your email name in the password." });
  }
});

export type RegistrationInput = z.infer<typeof registrationSchema>;

const coordinatesPaired = <T extends { latitude?: number | null; longitude?: number | null }>(value: T) =>
  (value.latitude === null || value.latitude === undefined) === (value.longitude === null || value.longitude === undefined);

export const onboardingSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("generator"),
    organizationName: safeText(160),
    operatingAddress: safeText(500),
    cityOrDistrict: safeText(120),
    stateOrRegion: z.string().trim().max(120).optional().default(""),
    postalCode: z.string().trim().max(20).optional().default(""),
    // Optional exact location. Without it the city is matched against the built-in gazetteer,
    // which is enough for a distance estimate but less precise.
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    contactName: safeText(120),
    contactEmail: z.string().email().max(254),
    contactPhone: z.string().trim().max(32).optional().default(""),
    serviceAreaId: z.string().uuid().optional().nullable(),
  }).strict(),
  z.object({
    role: z.literal("receiver"),
    organizationName: safeText(160),
    operatingAddress: safeText(500),
    cityOrDistrict: safeText(120),
    stateOrRegion: z.string().trim().max(120).optional().default(""),
    postalCode: z.string().trim().max(20).optional().default(""),
    // Optional exact location. Without it the city is matched against the built-in gazetteer,
    // which is enough for a distance estimate but less precise.
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    contactName: safeText(120),
    contactEmail: z.string().email().max(254),
    contactPhone: z.string().trim().max(32).optional().default(""),
    serviceAreaId: z.string().uuid().optional().nullable(),
    receivingCapacity: z.number().positive().max(100_000).optional(),
    capacityUnit: z.enum(["servings", "kg", "g", "litre", "portion", "box"]).optional().default("servings"),
    foodCapabilities: z.array(z.string().trim().min(1).max(64)).max(30).optional().default([]),
  }).strict(),
  z.object({
    role: z.literal("helper"),
    serviceAreaId: z.string().uuid().optional().nullable(),
    availabilityNotes: z.string().trim().max(500).optional().default(""),
    trainingAcknowledged: z.literal(true),
  }).strict(),
]).superRefine((value, ctx) => {
  // Half a coordinate is worse than none: it places an organisation on the equator.
  if (!coordinatesPaired(value as { latitude?: number | null; longitude?: number | null })) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["longitude"], message: "Give both coordinates, or neither." });
  }
});

export const donationCreateSchema = z.object({
  organizationId: z.string().uuid(),
  name: safeText(160),
  category: safeText(64),
  foodType: z.enum(["vegetarian", "non_vegetarian", "mixed", "other"]),
  description: z.string().trim().max(1_000).optional().default(""),
  quantity: z.number().positive().max(100_000),
  unit: z.enum(["servings", "kg", "g", "litre", "portion", "box"]),
  ingredients: z.string().trim().max(1_000).optional().default(""),
  allergens: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  preparedAt: z.string().datetime({ offset: true }),
  packedAt: z.string().datetime({ offset: true }).optional().nullable(),
  bestBeforeAt: z.string().datetime({ offset: true }),
  pickupEarliestAt: z.string().datetime({ offset: true }),
  pickupLatestAt: z.string().datetime({ offset: true }),
  storageInstructions: safeText(500),
  temperatureRequirement: z.string().trim().max(200).optional().default(""),
  pickupAddress: safeText(500),
  pickupInstructions: z.string().trim().max(500).optional().default(""),
  declarationsAccepted: z.literal(true),
}).strict().superRefine((value, context) => {
  const prepared = new Date(value.preparedAt).getTime();
  const packed = value.packedAt ? new Date(value.packedAt).getTime() : undefined;
  const bestBefore = new Date(value.bestBeforeAt).getTime();
  const earliest = new Date(value.pickupEarliestAt).getTime();
  const latest = new Date(value.pickupLatestAt).getTime();
  const now = Date.now();

  if (prepared > now) context.addIssue({ code: "custom", path: ["preparedAt"], message: "Preparation time cannot be in the future." });
  if (packed !== undefined && packed < prepared) context.addIssue({ code: "custom", path: ["packedAt"], message: "Packaging cannot be earlier than preparation." });
  if (bestBefore <= now) context.addIssue({ code: "custom", path: ["bestBeforeAt"], message: "This food's best-before time must be in the future." });
  if (earliest < now) context.addIssue({ code: "custom", path: ["pickupEarliestAt"], message: "Collection window must begin in the future." });
  if (latest <= earliest) context.addIssue({ code: "custom", path: ["pickupLatestAt"], message: "Latest collection must be after earliest collection." });
  if (bestBefore <= latest) context.addIssue({ code: "custom", path: ["bestBeforeAt"], message: "Food must remain within its declared date through the collection window." });
});

export const offerResponseSchema = z.object({
  action: z.enum(["accept", "reject"]),
  quantityAccepted: z.number().positive().max(100_000).optional(),
  reason: z.string().trim().min(5).max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "reject" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Add a brief reason for declining this offer." });
  }
});

export const pickupSchema = z.object({
  condition: safeText(500),
}).strict();

/**
 * The Receiver's arrival checks.
 *
 * The free-text note is still required — a person has to describe what they saw — but the four
 * boolean checks and the optional temperature are what make the record answerable afterwards. They
 * are deliberately individual booleans rather than one "all fine" tick: "the seal was broken but the
 * label matched" is information an investigation needs.
 *
 * `acceptanceConfirmed` requires every check to have been performed, and a temperature is required
 * whenever the listing declared a temperature requirement. A Receiver who cannot say what the
 * reading was cannot claim to have taken it.
 */
export const inspectionSchema = z.object({
  acceptanceConfirmed: z.literal(true),
  notes: safeText(500),
  sealIntact: z.boolean(),
  packagingIntact: z.boolean(),
  labelMatched: z.boolean(),
  withinWindow: z.boolean(),
  temperatureC: z.number().min(-40).max(120).optional().nullable(),
  /**
   * A SHA-256 of a photo taken at handover, already uploaded through the private-document path.
   * Optional: not every receiving organisation has a camera or a procedure that uses one, and
   * requiring it would invent a rule the safety officer has not approved.
   */
  photoSha256: z.string().trim().regex(/^[0-9a-f]{64}$/, "Use a lowercase SHA-256 hex digest.").optional().nullable(),
}).strict();

export const verifyDeliverySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
}).strict();

export const incidentSchema = z.object({
  incidentType: z.enum(["damaged_packaging", "temperature_concern", "allergen_mismatch", "quality_concern", "delay", "failed_collection", "other"]),
  severity: z.enum(["low", "moderate", "high", "critical"]),
  description: safeText(1_000),
  /** Recorded at report time; an incident can also be updated if harm becomes known later. */
  harmReported: z.boolean().optional().default(false),
  harmDetails: z.string().trim().min(10).max(1_000).optional().nullable(),
}).strict().superRefine((value, context) => {
  if (value.harmReported && !value.harmDetails) {
    context.addIssue({ code: "custom", path: ["harmDetails"], message: "Say who was affected and how, or clear the harm flag." });
  }
});

/**
 * Closing an incident. `correctiveAction` is required because a closure that does not say what
 * changed is how the same failure happens twice; the database enforces the same rule.
 */
export const incidentClosureSchema = z.object({
  resolution: safeText(800),
  correctiveAction: z.string().trim().min(20).max(1_000),
  /** Harm is re-declared at closure: it may have become known after the incident was reported. */
  harmReported: z.boolean(),
  harmDetails: z.string().trim().max(1_000).optional().nullable(),
}).strict().superRefine((value, context) => {
  if (value.harmReported && (!value.harmDetails || value.harmDetails.trim().length < 10)) {
    context.addIssue({ code: "custom", path: ["harmDetails"], message: "Say who was affected and how, or clear the harm flag." });
  }
});

/** An organisation's insurance declaration. Both fields or neither; the date must be in the future. */
export const organizationInsuranceSchema = z.object({
  insurancePolicyReference: z.string().trim().min(3).max(120),
  insuranceExpiresOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
}).strict().superRefine((value, context) => {
  const expiry = new Date(`${value.insuranceExpiresOn}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) {
    context.addIssue({ code: "custom", path: ["insuranceExpiresOn"], message: "Use a real date." });
    return;
  }
  if (expiry.getTime() < Date.now()) {
    context.addIssue({ code: "custom", path: ["insuranceExpiresOn"], message: "This policy has already expired. Record a current one." });
  }
});

/** Accepting the partner agreement. The version must be the one currently published. */
export const agreementAcceptanceSchema = z.object({
  version: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  accepted: z.literal(true),
}).strict();

/** A locked-out person asking operations for help. No account is required to file it. */
export const accountRecoveryRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  detail: z.string().trim().min(10).max(1_000),
}).strict();

/** An operator answering a recovery request. */
export const accountRecoveryResolutionSchema = z.object({
  status: z.enum(["in_review", "resolved", "declined"]),
  resolution: z.string().trim().min(10).max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.status !== "in_review" && !value.resolution) {
    context.addIssue({ code: "custom", path: ["resolution"], message: "Say what was done, or why it was declined." });
  }
});

/** Operator-assisted account recovery: a target address and the justification. */
export const accountRecoverySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // The reason is the only record of why a privileged person reset someone else's
  // password, so it is not optional and not one word.
  reason: z.string().trim().min(20).max(500),
}).strict();

/** Operations release of an uncollected assignment; the reason is the record. */
export const deliveryReleaseSchema = z.object({
  reason: safeText(500),
}).strict();

export const adminDecisionSchema = z.object({
  decision: z.enum(["approve", "request_information", "reject", "suspend"]),
  reason: safeText(500),
  serviceAreaId: z.string().uuid().optional().nullable(),
}).strict();

export const helperDecisionSchema = z.object({
  decision: z.enum(["approve", "reject", "suspend"]),
  reason: safeText(500),
  serviceAreaId: z.string().uuid().optional().nullable(),
}).strict();

/**
 * A recall must state why. It is the notice other organisations receive, so a
 * one-word reason is rejected rather than recorded as if it were evidence.
 */
export const recallRequestSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
}).strict();

export const recallClosureSchema = z.object({
  closureNote: z.string().trim().min(10).max(1000),
}).strict();

/** Password change from an authenticated session. The current password is required. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
  revokeOtherSessions: z.boolean().optional().default(false),
}).strict().superRefine((value, context) => {
  const issue = passwordIssue(value.newPassword);
  if (issue) context.addIssue({ code: "custom", path: ["newPassword"], message: issue });
  if (value.currentPassword === value.newPassword) {
    context.addIssue({ code: "custom", path: ["newPassword"], message: "Choose a password you have not used for this account." });
  }
});

/** Session revocation: either one named session, or every other session. */
export const sessionRevocationSchema = z.union([
  z.object({ sessionId: z.string().trim().min(1).max(200) }).strict(),
  z.object({ scope: z.literal("others") }).strict(),
]);

export const policyRulesSchema = z.object({
  allowedCategories: z.array(z.string().trim().min(1).max(64)).min(1).max(40),
  allowedFoodTypes: z.array(z.enum(["vegetarian", "non_vegetarian", "mixed", "other"])).min(1),
  minimumPickupLeadMinutes: z.number().int().min(0).max(10_080),
  minimumExpiryAfterPickupMinutes: z.number().int().min(0).max(10_080),
  offerResponseMinutes: z.number().int().min(5).max(240),
  allowPartialAcceptance: z.boolean(),
  requireAllergenDisclosure: z.boolean(),
}).strict();

export const policyDraftSchema = z.object({
  version: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  rules: policyRulesSchema,
}).strict();

export const policyApprovalSchema = z.object({
  effectiveFrom: z.string().datetime({ offset: true }),
}).strict();

const ianaTimezone = z.string().trim().min(1).max(80).refine((timezone) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}, "Choose a recognised IANA time zone.");

export const serviceAreaSchema = z.object({
  label: safeText(120),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("IN"),
  stateOrRegion: z.string().trim().max(120).optional().default(""),
  cityOrDistrict: z.string().trim().max(120).optional().default(""),
  timezone: ianaTimezone.default("Asia/Kolkata"),
  active: z.boolean().default(false),
}).strict();

export const serviceAreaUpdateSchema = serviceAreaSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Change at least one service-area field." },
);

export const supportCaseCreateSchema = z.object({
  organizationId: z.string().uuid().optional().nullable(),
  subject: safeText(160),
  description: safeText(2_000),
}).strict();

export const supportCaseUpdateSchema = z.object({
  status: z.enum(["open", "in_progress", "awaiting_user", "resolved", "closed"]),
}).strict();

export const dataRequestCreateSchema = z.object({
  requestType: z.enum(["access", "export", "rectification", "erasure", "restriction", "objection", "other"]),
  description: z.string().trim().max(1_000).optional().default(""),
}).strict();

export const dataRequestUpdateSchema = z.object({
  status: z.enum(["in_review", "awaiting_user", "completed", "rejected"]),
  resolution: safeText(800),
}).strict();

/**
 * Owner declarations. These are the facts no query can prove: who the entity is, what cover
 * exists, who answers data-protection questions, and when an outsider last tried to break in.
 * Each requires held evidence, so a declaration cannot be a bare assertion.
 */
const evidenceReference = z.string().trim().min(3).max(500);
const isoDay = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const futureDay = z.string().trim().datetime({ offset: true }).or(isoDay);

export const attestationSchema = z.discriminatedUnion("key", [
  z.object({
    key: z.literal("legal_entity"),
    evidenceReference,
    expiresAt: futureDay.nullish(),
    value: z.object({
      entityName: safeText(200),
      jurisdiction: safeText(120),
      registeredAddress: safeText(500),
      registrationReference: z.string().trim().max(120).optional().default(""),
      liabilityPosition: safeText(500),
    }).strict(),
  }).strict(),
  z.object({
    key: z.literal("insurance"),
    evidenceReference,
    expiresAt: futureDay,
    value: z.object({
      insurer: safeText(160),
      policyReference: safeText(120),
      coverageSummary: safeText(1_000),
      liabilityLimit: z.string().trim().max(120).optional().default(""),
    }).strict(),
  }).strict(),
  z.object({
    key: z.literal("data_protection_contact"),
    evidenceReference,
    expiresAt: futureDay.nullish(),
    value: z.object({
      contactName: safeText(160),
      contactEmail: z.string().trim().email().max(320),
      hours: safeText(120),
      postalAddress: safeText(500),
    }).strict(),
  }).strict(),
  z.object({
    key: z.literal("penetration_test"),
    evidenceReference,
    expiresAt: futureDay.nullish(),
    value: z.object({
      provider: safeText(160),
      reportReference: safeText(160),
      completedOn: isoDay,
      scopeSummary: safeText(1_000),
    }).strict(),
  }).strict(),
]);

export const onCallShiftSchema = z.object({
  userId: z.string().trim().min(1).max(64).optional(),
  email: z.string().trim().email().max(320).optional(),
  startsAt: z.string().trim().datetime({ offset: true }),
  endsAt: z.string().trim().datetime({ offset: true }),
  channel: safeText(160),
  notes: z.string().trim().max(500).optional().default(""),
}).strict().refine((value) => Boolean(value.userId || value.email), {
  message: "Name the person on call, by account email or account id.",
  path: ["email"],
}).refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
  message: "The shift must end after it starts.",
  path: ["endsAt"],
}).refine((value) => new Date(value.endsAt).getTime() - new Date(value.startsAt).getTime() <= 14 * 86_400_000, {
  message: "Schedule shifts of at most fourteen days.",
  path: ["endsAt"],
});

/**
 * Directory maintenance. Publishing a place, recording who actually answered the phone, and noting
 * that the owner confirmed the details are three separate decisions; this schema allows any subset
 * but at least one, and never a licence claim.
 */
export const directoryPlaceUpdateSchema = z.object({
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  phone: z.string().trim().max(40).regex(/^[+0-9 ()-]*$/, "Use digits, spaces, brackets, + and - only.").nullable().optional(),
  phoneKind: z.enum(["unknown", "direct", "business_line", "marketplace_line"]).optional(),
  consentStatus: z.enum(["unknown", "contacted", "consented", "declined"]).optional(),
  published: z.boolean().optional(),
  ownerVerified: z.boolean().optional(),
  /** Publishing a number requires the owner's agreement; the service refuses without it. */
  publishPhone: z.boolean().optional(),
  // A photo the owner handed over. Listing-site images are copyrighted and are not copied in.
  photoUrl: z.string().trim().url().max(500).startsWith("https://").nullable().optional(),
  notes: z.string().trim().max(8_000).nullable().optional(),
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== "slug"),
  { message: "Change at least one field." },
);

/**
 * Retention windows. The bounds mirror the CHECK constraint in migration 21, so an invalid window is
 * rejected with a readable message before the database has to say no.
 */
export const retentionSettingsSchema = z.object({
  notificationsDays: z.number().int().min(7).max(3650).optional(),
  otpDays: z.number().int().min(1).max(30).optional(),
  deliveryCodesDays: z.number().int().min(1).max(365).optional(),
  closedIncidentsDays: z.number().int().min(30).max(3650).optional(),
  failedJobsDays: z.number().int().min(1).max(365).optional(),
  auditYears: z.number().int().min(1).max(25).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Change at least one retention window." },
);

export const retentionHoldSchema = z.object({
  scopeType: z.enum(["user", "organization", "job", "donation"]),
  subjectId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(10).max(1000),
}).strict();

export const retentionHoldReleaseSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
}).strict();

export const retentionRunSchema = z.object({
  dryRun: z.boolean().optional().default(false),
}).strict();

export const erasureSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(10).max(1000),
}).strict();
