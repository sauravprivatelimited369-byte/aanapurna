import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
export const requestedRoleEnum = pgEnum("requested_role", ["generator", "receiver", "helper"]);
export const accountStatus = pgEnum("account_status", ["pending", "active", "suspended", "locked", "deactivated"]);
export const platformRole = pgEnum("platform_role", ["operations_admin", "support_agent", "safety_officer", "security_admin"]);
export const organizationType = pgEnum("organization_type", ["generator", "receiver"]);
export const verificationStatus = pgEnum("verification_status", ["draft", "submitted", "under_review", "information_required", "verified", "rejected", "suspended", "expired"]);
export const membershipRole = pgEnum("membership_role", ["owner", "manager", "operator", "viewer"]);
export const membershipStatus = pgEnum("membership_status", ["pending", "active", "suspended", "removed"]);
export const helperStatus = pgEnum("helper_status", ["pending", "active", "suspended", "rejected"]);
export const donationStatus = pgEnum("donation_status", ["draft", "offered", "reserved", "assigned", "collected", "delivered", "expired", "cancelled", "refused", "on_hold", "recalled"]);
export const offerStatus = pgEnum("offer_status", ["pending", "accepted", "rejected", "withdrawn", "expired"]);
export const deliveryStatus = pgEnum("delivery_status", ["open", "assigned", "collected", "delivered", "cancelled", "refused", "on_hold"]);
export const outboxStatus = pgEnum("outbox_status", ["pending", "processing", "sent", "failed"]);

// Better Auth's core tables. Keep these names and fields aligned with its Drizzle adapter.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  requestedRole: requestedRoleEnum("requested_role"),
  // Transient registration intake fields. Better Auth writes them here, then a
  // create hook moves them into the RLS-protected registration_profiles table
  // and clears these columns. They are never returned to the browser.
  registrationPhone: text("registration_phone"),
  registrationOrganizationName: text("registration_organization_name"),
  registrationOrganizationType: organizationType("registration_organization_type"),
  registrationAddressLine: text("registration_address_line"),
  registrationCityOrDistrict: text("registration_city_or_district"),
  registrationStateOrRegion: text("registration_state_or_region"),
  registrationPostalCode: text("registration_postal_code"),
  registrationProfileNotes: text("registration_profile_notes"),
  // Set by Better Auth's two-factor plugin after a second factor is confirmed.
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

/**
 * Better Auth two-factor secrets. The application role is given no privilege at
 * all on this table: the shared secret and backup codes are read only by the
 * authentication role inside Better Auth.
 */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: instant("locked_until"),
  },
  (table) => [index("two_factor_user_idx").on(table.userId)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: instant("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  accountStatus: accountStatus("account_status").notNull().default("pending"),
  requestedRole: requestedRoleEnum("requested_role"),
  displayName: text("display_name"),
  demoAccount: boolean("demo_account").notNull().default(false),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

/**
 * Registration intake details. Only the owning user and authorised platform
 * staff can read them; the app role has no UPDATE or DELETE grant at all.
 */
export const registrationProfiles = pgTable("registration_profiles", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  requestedRole: requestedRoleEnum("requested_role").notNull(),
  phone: text("phone").notNull(),
  organizationName: text("organization_name"),
  organizationType: organizationType("organization_type"),
  addressLine: text("address_line").notNull(),
  cityOrDistrict: text("city_or_district").notNull(),
  stateOrRegion: text("state_or_region"),
  postalCode: text("postal_code"),
  profileNotes: text("profile_notes").notNull(),
  verificationStatus: verificationStatus("verification_status").notNull().default("submitted"),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
}, (table) => [index("registration_profiles_area_idx").on(table.cityOrDistrict)]);

export const platformRoles = pgTable(
  "platform_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: platformRole("role").notNull(),
    grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("platform_roles_user_role_uq").on(table.userId, table.role)],
);

export const apiRateLimits = pgTable("api_rate_limits", {
  key: text("key").primaryKey(),
  windowStartedAt: instant("window_started_at").notNull(),
  count: integer("count").notNull(),
  expiresAt: instant("expires_at").notNull(),
});

export const serviceHealth = pgTable("service_health", {
  service: text("service").primaryKey(),
  status: text("status").notNull(),
  details: jsonb("details").notNull().default({}),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

export const serviceAreas = pgTable(
  "service_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    countryCode: text("country_code").notNull().default("IN"),
    stateOrRegion: text("state_or_region"),
    cityOrDistrict: text("city_or_district"),
    // Null means "no limit configured": the estimate is shown but nothing is refused.
    maxTransitKm: numeric("max_transit_km", { precision: 6, scale: 2 }),
    averageSpeedKmph: numeric("average_speed_kmph", { precision: 5, scale: 1 }).notNull().default("20"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    active: boolean("active").notNull().default(false),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [index("service_areas_active_idx").on(table.active)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: organizationType("type").notNull(),
    status: verificationStatus("status").notNull().default("draft"),
    serviceAreaId: uuid("service_area_id").references(() => serviceAreas.id, { onDelete: "set null" }),
    operatingAddress: text("operating_address").notNull(),
    cityOrDistrict: text("city_or_district").notNull(),
    stateOrRegion: text("state_or_region"),
    postalCode: text("postal_code"),
    // Optional exact location. When absent, the city name is matched against the gazetteer.
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    contactName: text("contact_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    contactPhone: text("contact_phone"),
    receivingCapacity: numeric("receiving_capacity", { precision: 12, scale: 3 }),
    capacityUnit: text("capacity_unit"),
    foodCapabilities: text("food_capabilities").array().notNull().default([]),
    // Evidence a human reviewed before the organisation was verified. These are declarations with a
    // date and a reference, not certificates the platform issued, and they expire on their own.
    insurancePolicyReference: text("insurance_policy_reference"),
    insuranceExpiresOn: date("insurance_expires_on", { mode: "string" }),
    // The agreement version this organisation accepted. Bumping the published agreement makes every
    // previous acceptance visibly stale instead of silently grandfathered.
    agreementVersion: text("agreement_version"),
    agreementAcceptedAt: instant("agreement_accepted_at"),
    createdBy: text("created_by").notNull().references(() => user.id),
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewReason: text("review_reason"),
    reviewedAt: instant("reviewed_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [index("organizations_status_area_idx").on(table.status, table.serviceAreaId)],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("operator"),
    status: membershipStatus("status").notNull().default("pending"),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_memberships_org_user_uq").on(table.organizationId, table.userId),
    index("organization_memberships_user_status_idx").on(table.userId, table.status),
  ],
);

export const helperProfiles = pgTable("helper_profiles", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  status: helperStatus("status").notNull().default("pending"),
  serviceAreaId: uuid("service_area_id").references(() => serviceAreas.id, { onDelete: "set null" }),
  availabilityNotes: text("availability_notes"),
  trainingAcknowledgedAt: instant("training_acknowledged_at"),
  approvedBy: text("approved_by").references(() => user.id),
  approvedAt: instant("approved_at"),
  reviewedBy: text("reviewed_by").references(() => user.id),
  reviewedAt: instant("reviewed_at"),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

export const donations = pgTable(
  "donations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generatorOrganizationId: uuid("generator_organization_id").notNull().references(() => organizations.id),
    receiverOrganizationId: uuid("receiver_organization_id").references(() => organizations.id),
    serviceAreaId: uuid("service_area_id").references(() => serviceAreas.id, { onDelete: "set null" }),
    pickupCity: text("pickup_city").notNull(),
    pickupState: text("pickup_state"),
    createdBy: text("created_by").notNull().references(() => user.id),
    name: text("name").notNull(),
    category: text("category").notNull(),
    foodType: text("food_type").notNull(),
    description: text("description"),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unit: text("unit").notNull(),
    ingredients: text("ingredients"),
    allergens: text("allergens").array().notNull().default([]),
    preparedAt: instant("prepared_at").notNull(),
    packedAt: instant("packed_at"),
    bestBeforeAt: instant("best_before_at").notNull(),
    pickupEarliestAt: instant("pickup_earliest_at").notNull(),
    pickupLatestAt: instant("pickup_latest_at").notNull(),
    storageInstructions: text("storage_instructions").notNull(),
    temperatureRequirement: text("temperature_requirement"),
    policyVersion: text("policy_version").notNull(),
    status: donationStatus("status").notNull().default("offered"),
    holdReason: text("hold_reason"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("donations_generator_status_idx").on(table.generatorOrganizationId, table.status, table.createdAt),
    index("donations_expiry_status_idx").on(table.status, table.bestBeforeAt),
    index("donations_receiver_status_idx").on(table.receiverOrganizationId, table.status),
  ],
);

export const donationPrivateDetails = pgTable("donation_private_details", {
  donationId: uuid("donation_id").primaryKey().references(() => donations.id, { onDelete: "cascade" }),
  pickupAddress: text("private_pickup_address").notNull(),
  pickupInstructions: text("private_pickup_instructions"),
  createdAt: instant("created_at").notNull().defaultNow(),
});

export const donationOffers = pgTable(
  "donation_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    donationId: uuid("donation_id").notNull().references(() => donations.id, { onDelete: "cascade" }),
    receiverOrganizationId: uuid("receiver_organization_id").notNull().references(() => organizations.id),
    status: offerStatus("status").notNull().default("pending"),
    quantityAccepted: numeric("quantity_accepted", { precision: 12, scale: 3 }),
    responseReason: text("response_reason"),
    respondedBy: text("responded_by").references(() => user.id),
    respondedAt: instant("responded_at"),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("donation_offers_donation_receiver_uq").on(table.donationId, table.receiverOrganizationId),
    index("donation_offers_receiver_status_idx").on(table.receiverOrganizationId, table.status, table.expiresAt),
  ],
);

export const deliveryJobs = pgTable(
  "delivery_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    donationId: uuid("donation_id").notNull().unique().references(() => donations.id),
    offerId: uuid("offer_id").notNull().unique().references(() => donationOffers.id),
    generatorOrganizationId: uuid("generator_organization_id").notNull().references(() => organizations.id),
    receiverOrganizationId: uuid("receiver_organization_id").notNull().references(() => organizations.id),
    helperUserId: text("helper_user_id").references(() => user.id),
    status: deliveryStatus("status").notNull().default("open"),
    claimedAt: instant("claimed_at"),
    claimExpiresAt: instant("claim_expires_at"),
    collectedAt: instant("collected_at"),
    arrivedAt: instant("arrived_at"),
    arrivalReportedBy: text("arrival_reported_by").references(() => user.id),
    inspectionConfirmedAt: instant("inspection_confirmed_at"),
    inspectionConfirmedBy: text("inspection_confirmed_by").references(() => user.id),
    inspectionNotes: text("inspection_notes"),
    // The structured acceptance checks a Receiver performs on arrival. Kept separate from the free
    // text so that "was a temperature read and recorded" is a fact the database can answer, not a
    // sentence somebody wrote. Each column is nullable for deliveries that predate the checklist.
    inspectionTemperatureC: numeric("inspection_temperature_c", { precision: 5, scale: 2 }),
    inspectionSealIntact: boolean("inspection_seal_intact"),
    inspectionPackagingIntact: boolean("inspection_packaging_intact"),
    inspectionLabelMatched: boolean("inspection_label_matched"),
    inspectionWithinWindow: boolean("inspection_within_window"),
    inspectionPhotoSha256: text("inspection_photo_sha256"),
    deliveredAt: instant("delivered_at"),
    collectionCondition: text("collection_condition"),
    deliveryCondition: text("delivery_condition"),
    exceptionReason: text("exception_reason"),
    // How the food travels: by an approved Helper, or collected by the receiving organisation.
    collectionMode: text("collection_mode").notNull().default("helper_delivery"),
    // Recorded once at assignment. Null means the distance could not be established.
    transitDistanceKm: numeric("transit_distance_km", { precision: 6, scale: 2 }),
    transitEtaMinutes: integer("transit_eta_minutes"),
    transitCheckedAt: instant("transit_checked_at"),
    // Set by the escalation sweep once operations staff have been told an open
    // job has gone unclaimed, so the same job is not reported every run.
    escalatedAt: instant("escalated_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("delivery_jobs_helper_status_idx").on(table.helperUserId, table.status),
    index("delivery_jobs_open_escalation_idx").on(table.status, table.escalatedAt, table.createdAt),
    index("delivery_jobs_receiver_status_idx").on(table.receiverOrganizationId, table.status),
    uniqueIndex("delivery_jobs_active_helper_uq").on(table.helperUserId, table.donationId),
  ],
);

/**
 * Read-only gazetteer of Indian places, matched against the free-text city the onboarding form
 * captures. It exists so a distance can be estimated without collecting coordinates from anyone
 * first, and so the application never invents a number it cannot support.
 */
/**
 * Owner declarations that no code can verify. Each row names who declared it, when it must be
 * renewed, and what evidence is held. The launch gate reads these instead of trusting prose.
 */
export const platformAttestations = pgTable("platform_attestations", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  value: jsonb("value").notNull().default({}),
  evidenceReference: text("evidence_reference"),
  recordedBy: text("recorded_by").references(() => user.id, { onDelete: "set null" }),
  recordedAt: instant("recorded_at").notNull().defaultNow(),
  expiresAt: instant("expires_at"),
  // Cleared on every re-record so a renewal re-arms the lapse reminder.
  renewalRemindedAt: instant("renewal_reminded_at"),
});

/** A staffed rota. Readiness requires real coverage, not an intention to be reachable. */
export const onCallShifts = pgTable("on_call_shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  startsAt: instant("starts_at").notNull(),
  endsAt: instant("ends_at").notNull(),
  channel: text("channel").notNull(),
  notes: text("notes"),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [index("on_call_shifts_window_idx").on(table.startsAt, table.endsAt)]);

/**
 * Curated food sources near the Joka campus. Public columns are published with an "unconfirmed"
 * label; phone numbers stay private because ringing a business about a scheme it has never heard of
 * is an approach a person makes deliberately, not a side effect of a page render.
 */
export const directoryPlaces = pgTable("directory_places", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  area: text("area").notNull(),
  addressLine: text("address_line"),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  phone: text("phone"),
  // Both this and a recorded owner consent are required before the public reader returns a number.
  publishPhone: boolean("publish_phone").notNull().default(false),
  phoneSource: text("phone_source"),
  phoneKind: text("phone_kind").notNull().default("unknown"),
  sourceUrl: text("source_url"),
  lastCheckedOn: text("last_checked_on").notNull(),
  consentStatus: text("consent_status").notNull().default("unknown"),
  ownerVerified: boolean("owner_verified").notNull().default(false),
  published: boolean("published").notNull().default(false),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
}, (table) => [index("directory_places_category_idx").on(table.category, table.name)]);

export const geoPlaces = pgTable("geo_places", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
  longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
});

export const deliveryDestinationDetails = pgTable("delivery_destination_details", {
  deliveryJobId: uuid("delivery_job_id").primaryKey().references(() => deliveryJobs.id, { onDelete: "cascade" }),
  receiverName: text("receiver_name").notNull(),
  receiverAddress: text("receiver_address").notNull(),
  receiverCity: text("receiver_city").notNull(),
  receivingContactName: text("receiving_contact_name").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
});

export const deliveryCodes = pgTable("delivery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  deliveryJobId: uuid("delivery_job_id").notNull().unique().references(() => deliveryJobs.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  encryptedCode: text("encrypted_code").notNull(),
  encryptionKeyVersion: text("encryption_key_version").notNull().default("v1"),
  expiresAt: instant("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lockedAt: instant("locked_at"),
  consumedAt: instant("consumed_at"),
  createdAt: instant("created_at").notNull().defaultNow(),
});

export const custodyEvents = pgTable(
  "custody_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    donationId: uuid("donation_id").notNull().references(() => donations.id),
    deliveryJobId: uuid("delivery_job_id").references(() => deliveryJobs.id),
    actorUserId: text("actor_user_id").notNull().references(() => user.id),
    eventType: text("event_type").notNull(),
    occurredAt: instant("occurred_at").notNull().defaultNow(),
    details: jsonb("details").notNull().default({}),
  },
  (table) => [index("custody_events_donation_time_idx").on(table.donationId, table.occurredAt)],
);

export const receipts = pgTable(
  "delivery_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    donationId: uuid("donation_id").notNull().unique().references(() => donations.id),
    deliveryJobId: uuid("delivery_job_id").notNull().unique().references(() => deliveryJobs.id),
    generatorOrganizationId: uuid("generator_organization_id").notNull().references(() => organizations.id),
    receiverOrganizationId: uuid("receiver_organization_id").notNull().references(() => organizations.id),
    helperUserId: text("helper_user_id").notNull().references(() => user.id),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unit: text("unit").notNull(),
    collectedAt: instant("collected_at").notNull(),
    deliveredAt: instant("delivered_at").notNull(),
    verified: boolean("verified").notNull().default(true),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [index("receipts_created_at_idx").on(table.createdAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    reason: text("reason"),
    requestId: text("request_id"),
    details: jsonb("details").notNull().default({}),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_entity_time_idx").on(table.entityType, table.entityId, table.createdAt),
    index("audit_events_actor_time_idx").on(table.actorUserId, table.createdAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    readAt: instant("read_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [index("notifications_user_unread_idx").on(table.userId, table.readAt, table.createdAt)],
);

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipient: text("recipient").notNull(),
    kind: text("kind").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: instant("available_at").notNull().defaultNow(),
    lastError: text("last_error"),
    messageId: text("message_id").notNull().unique(),
    sentAt: instant("sent_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [index("email_outbox_pending_idx").on(table.status, table.availableAt)],
);

export const supportCases = pgTable(
  "support_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    createdBy: text("created_by").notNull().references(() => user.id),
    organizationId: uuid("organization_id").references(() => organizations.id),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("open"),
    assignedTo: text("assigned_to").references(() => user.id),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [index("support_cases_status_created_idx").on(table.status, table.createdAt)],
);

export const safetyIncidents = pgTable(
  "food_safety_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    donationId: uuid("donation_id").notNull().references(() => donations.id),
    deliveryJobId: uuid("delivery_job_id").references(() => deliveryJobs.id),
    reportedBy: text("reported_by").notNull().references(() => user.id),
    incidentType: text("incident_type").notNull(),
    severity: text("severity").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("open"),
    holdApplied: boolean("hold_applied").notNull().default(false),
    resolution: text("resolution"),
    // Harm assessment. "Was anyone made ill, and did they need care?" is the first question after a
    // recall, and the answer has to be recorded by a person with a name and a time, not inferred.
    harmReported: boolean("harm_reported").notNull().default(false),
    harmDetails: text("harm_details"),
    // The repair, as opposed to the closure: what changed so that the same failure cannot recur.
    correctiveAction: text("corrective_action"),
    correctiveActionOwner: text("corrective_action_owner").references(() => user.id),
    closedBy: text("closed_by").references(() => user.id),
    closedAt: instant("closed_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [index("food_safety_incidents_donation_status_idx").on(table.donationId, table.status)],
);

export const recallRecords = pgTable(
  "recall_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    donationId: uuid("donation_id").notNull().references(() => donations.id),
    status: text("status").notNull().default("open"),
    reason: text("reason").notNull(),
    // Snapshot counts, so a later receipt correction cannot rewrite what the
    // recall notice said at the moment it was issued.
    affectedReceiptCount: integer("affected_receipt_count").notNull().default(0),
    recalledStatus: text("recalled_status").notNull(),
    initiatedBy: text("initiated_by").notNull().references(() => user.id),
    initiatedAt: instant("initiated_at").notNull().defaultNow(),
    closedBy: text("closed_by").references(() => user.id),
    closedAt: instant("closed_at"),
    closureNote: text("closure_note"),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("recall_records_donation_idx").on(table.donationId, table.status),
    index("recall_records_open_idx").on(table.initiatedAt),
  ],
);

export const privateDocuments = pgTable(
  "private_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by").notNull().references(() => user.id),
    storageKey: text("storage_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    declaredContentType: text("declared_content_type").notNull(),
    detectedContentType: text("detected_content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    documentType: text("document_type").notNull(),
    scanStatus: text("scan_status").notNull().default("unscanned"),
    expiresAt: instant("expires_at"),
    // Set when operations have been reminded that this evidence is expiring, so
    // the reminder is sent once per document rather than on every sweep.
    expiryNotifiedAt: instant("expiry_notified_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [index("private_documents_org_idx").on(table.organizationId, table.createdAt)],
);

export const dataRequests = pgTable(
  "data_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id),
    requestType: text("request_type").notNull(),
    description: text("description"),
    status: text("status").notNull().default("submitted"),
    assignedTo: text("assigned_to").references(() => user.id),
    resolution: text("resolution"),
    reviewedBy: text("reviewed_by").references(() => user.id),
    completedAt: instant("completed_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [index("data_requests_user_status_idx").on(table.userId, table.status)],
);

export const policyVersions = pgTable("policy_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: text("version").notNull().unique(),
  status: text("status").notNull().default("draft"),
  rules: jsonb("rules").notNull().default({}),
  createdBy: text("created_by").references(() => user.id),
  approvedBy: text("approved_by").references(() => user.id),
  approvedAt: instant("approved_at"),
  effectiveFrom: instant("effective_from"),
  createdAt: instant("created_at").notNull().defaultNow(),
});

/**
 * The written partner agreement, versioned and accepted in the application.
 *
 * `OPERATING_MODEL.md` says the operator needs "a written partner agreement stating who is
 * responsible for which stage, and what happens on harm". This table is the record that a named
 * member of an organisation read a specific version and accepted it. It is not a contract: the
 * version text lives in `src/domain/partner-agreement.ts`, the acceptance records who and when, and
 * a legal review is still required before anyone relies on it.
 *
 * There is deliberately no DELETE policy. An acceptance is evidence.
 */
export const partnerAgreementAcceptances = pgTable(
  "partner_agreement_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    acceptedBy: text("accepted_by").notNull().references(() => user.id),
    acceptedAt: instant("accepted_at").notNull().defaultNow(),
    // What the person was shown, hashed, so a later edit to the text cannot rewrite the record of
    // what was accepted.
    contentSha256: text("content_sha256").notNull(),
  },
  (table) => [
    uniqueIndex("partner_agreement_org_version_uq").on(table.organizationId, table.version),
    index("partner_agreement_org_idx").on(table.organizationId, table.acceptedAt),
  ],
);

/**
 * Account-recovery intake for a person who is not signed in.
 *
 * The existing operator-assisted reset (`/api/admin/account-recovery`) requires the person to reach
 * an operator by some other channel. This table is that channel: a locked-out person states which
 * address needs help and what happened, operations see it in the queue, and the resolution column
 * records the outcome. It cannot be used to enumerate accounts because the success response is
 * identical either way, and the recorded request is rate-limited per address and per IP.
 */
export const accountRecoveryRequests = pgTable(
  "account_recovery_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    email: text("email").notNull(),
    detail: text("detail").notNull(),
    status: text("status").notNull().default("submitted"),
    resolvedBy: text("resolved_by").references(() => user.id),
    resolution: text("resolution"),
    resolvedAt: instant("resolved_at"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [index("account_recovery_status_idx").on(table.status, table.createdAt)],
);

/**
 * The retention windows the sweeper obeys, in one row.
 *
 * The privacy page quotes these numbers and `public.app_apply_retention` reads them, so the sentence
 * a person reads and the deletion that happens cannot drift apart. `id = 1` is enforced by a CHECK.
 */
export const dataRetentionSettings = pgTable("data_retention_settings", {
  id: integer("id").primaryKey().default(1),
  notificationsDays: integer("notifications_days").notNull().default(90),
  otpDays: integer("otp_days").notNull().default(1),
  deliveryCodesDays: integer("delivery_codes_days").notNull().default(30),
  closedIncidentsDays: integer("closed_incidents_days").notNull().default(730),
  failedJobsDays: integer("failed_jobs_days").notNull().default(30),
  auditYears: integer("audit_years").notNull().default(6),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

/**
 * A legal or investigative hold. While a hold is unreleased, every retention window is skipped for
 * the rows that belong to its scope. Held rows are still visible to staff, never deleted.
 */
export const retentionHolds = pgTable(
  "retention_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeType: text("scope_type").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    deliveryJobId: uuid("delivery_job_id").references(() => deliveryJobs.id, { onDelete: "cascade" }),
    donationId: uuid("donation_id").references(() => donations.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    placedBy: text("placed_by").notNull().references(() => user.id),
    placedAt: instant("placed_at").notNull().defaultNow(),
    releasedBy: text("released_by").references(() => user.id),
    releasedAt: instant("released_at"),
    releaseReason: text("release_reason"),
  },
  (table) => [
    index("retention_holds_active_user_idx").on(table.userId),
    index("retention_holds_active_org_idx").on(table.organizationId),
  ],
);

/**
 * One row per retention action that ran, including previews and hold-skips. Append-only: the
 * application has SELECT and nothing else, and the sweep writes through a SECURITY DEFINER function.
 */
export const dataScrubLog = pgTable(
  "data_scrub_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull(),
    category: text("category").notNull(),
    action: text("action").notNull(),
    windowDays: integer("window_days"),
    affectedRows: integer("affected_rows").notNull().default(0),
    skippedByHold: integer("skipped_by_hold").notNull().default(0),
    dryRun: boolean("dry_run").notNull().default(false),
    executedAt: instant("executed_at").notNull().defaultNow(),
  },
  (table) => [index("data_scrub_log_time_idx").on(table.executedAt)],
);
