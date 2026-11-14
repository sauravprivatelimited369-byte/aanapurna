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

export const onboardingSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("generator"),
    organizationName: safeText(160),
    operatingAddress: safeText(500),
    cityOrDistrict: safeText(120),
    stateOrRegion: z.string().trim().max(120).optional().default(""),
    postalCode: z.string().trim().max(20).optional().default(""),
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
]);

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

export const inspectionSchema = z.object({
  acceptanceConfirmed: z.literal(true),
  notes: safeText(500),
}).strict();

export const verifyDeliverySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
}).strict();

export const incidentSchema = z.object({
  incidentType: z.enum(["damaged_packaging", "temperature_concern", "allergen_mismatch", "quality_concern", "delay", "failed_collection", "other"]),
  severity: z.enum(["low", "moderate", "high", "critical"]),
  description: safeText(1_000),
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

export const incidentResolutionSchema = z.object({
  resolution: safeText(800),
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
