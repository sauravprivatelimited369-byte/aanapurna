CREATE TYPE "public"."account_status" AS ENUM('pending', 'active', 'suspended', 'locked', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('open', 'assigned', 'collected', 'delivered', 'cancelled', 'refused', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."donation_status" AS ENUM('draft', 'offered', 'reserved', 'assigned', 'collected', 'delivered', 'expired', 'cancelled', 'refused', 'on_hold', 'recalled');--> statement-breakpoint
CREATE TYPE "public"."helper_status" AS ENUM('pending', 'active', 'suspended', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'manager', 'operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('pending', 'active', 'suspended', 'removed');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'rejected', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "public"."organization_type" AS ENUM('generator', 'receiver');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('operations_admin', 'support_agent', 'safety_officer', 'security_admin');--> statement-breakpoint
CREATE TYPE "public"."requested_role" AS ENUM('generator', 'receiver', 'helper');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('draft', 'submitted', 'under_review', 'information_required', 'verified', 'rejected', 'suspended', 'expired');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"organization_id" uuid,
	"reason" text,
	"request_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custody_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donation_id" uuid NOT NULL,
	"delivery_job_id" uuid,
	"actor_user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"request_type" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"assigned_to" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_job_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"encrypted_code" text NOT NULL,
	"encryption_key_version" text DEFAULT 'v1' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_codes_delivery_job_id_unique" UNIQUE("delivery_job_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donation_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"generator_organization_id" uuid NOT NULL,
	"receiver_organization_id" uuid NOT NULL,
	"helper_user_id" text,
	"status" "delivery_status" DEFAULT 'open' NOT NULL,
	"claimed_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"collection_condition" text,
	"delivery_condition" text,
	"exception_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_jobs_donation_id_unique" UNIQUE("donation_id"),
	CONSTRAINT "delivery_jobs_offer_id_unique" UNIQUE("offer_id")
);
--> statement-breakpoint
CREATE TABLE "donation_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donation_id" uuid NOT NULL,
	"receiver_organization_id" uuid NOT NULL,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"quantity_accepted" numeric(12, 3),
	"response_reason" text,
	"responded_by" text,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generator_organization_id" uuid NOT NULL,
	"receiver_organization_id" uuid,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"food_type" text NOT NULL,
	"description" text,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" text NOT NULL,
	"ingredients" text,
	"allergens" text[] DEFAULT '{}' NOT NULL,
	"prepared_at" timestamp with time zone NOT NULL,
	"packed_at" timestamp with time zone,
	"best_before_at" timestamp with time zone NOT NULL,
	"pickup_earliest_at" timestamp with time zone NOT NULL,
	"pickup_latest_at" timestamp with time zone NOT NULL,
	"storage_instructions" text NOT NULL,
	"temperature_requirement" text,
	"pickup_address" text NOT NULL,
	"pickup_instructions" text,
	"policy_version" text NOT NULL,
	"status" "donation_status" DEFAULT 'offered' NOT NULL,
	"hold_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" text NOT NULL,
	"kind" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"message_id" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "helper_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" "helper_status" DEFAULT 'pending' NOT NULL,
	"service_area_id" uuid,
	"availability_notes" text,
	"training_acknowledged_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" DEFAULT 'operator' NOT NULL,
	"status" "membership_status" DEFAULT 'pending' NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "organization_type" NOT NULL,
	"status" "verification_status" DEFAULT 'draft' NOT NULL,
	"service_area_id" uuid,
	"operating_address" text NOT NULL,
	"city_or_district" text NOT NULL,
	"state_or_region" text,
	"postal_code" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"receiving_capacity" numeric(12, 3),
	"capacity_unit" text,
	"food_capabilities" text[] DEFAULT '{}' NOT NULL,
	"created_by" text NOT NULL,
	"reviewed_by" text,
	"review_reason" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" "platform_role" NOT NULL,
	"granted_by" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"effective_from" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "private_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"uploaded_by" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"declared_content_type" text NOT NULL,
	"detected_content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"document_type" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"donation_id" uuid NOT NULL,
	"delivery_job_id" uuid NOT NULL,
	"generator_organization_id" uuid NOT NULL,
	"receiver_organization_id" uuid NOT NULL,
	"helper_user_id" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_receipts_reference_unique" UNIQUE("reference"),
	CONSTRAINT "delivery_receipts_donation_id_unique" UNIQUE("donation_id"),
	CONSTRAINT "delivery_receipts_delivery_job_id_unique" UNIQUE("delivery_job_id")
);
--> statement-breakpoint
CREATE TABLE "food_safety_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donation_id" uuid NOT NULL,
	"delivery_job_id" uuid,
	"reported_by" text NOT NULL,
	"incident_type" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"hold_applied" boolean DEFAULT false NOT NULL,
	"resolution" text,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"country_code" text DEFAULT 'IN' NOT NULL,
	"state_or_region" text,
	"city_or_district" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_health" (
	"service" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "support_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"created_by" text NOT NULL,
	"organization_id" uuid,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_cases_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"account_status" "account_status" DEFAULT 'pending' NOT NULL,
	"requested_role" "requested_role",
	"display_name" text,
	"demo_account" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_delivery_job_id_delivery_jobs_id_fk" FOREIGN KEY ("delivery_job_id") REFERENCES "public"."delivery_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_codes" ADD CONSTRAINT "delivery_codes_delivery_job_id_delivery_jobs_id_fk" FOREIGN KEY ("delivery_job_id") REFERENCES "public"."delivery_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_offer_id_donation_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."donation_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_generator_organization_id_organizations_id_fk" FOREIGN KEY ("generator_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_receiver_organization_id_organizations_id_fk" FOREIGN KEY ("receiver_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_helper_user_id_user_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_offers" ADD CONSTRAINT "donation_offers_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_offers" ADD CONSTRAINT "donation_offers_receiver_organization_id_organizations_id_fk" FOREIGN KEY ("receiver_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_offers" ADD CONSTRAINT "donation_offers_responded_by_user_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_generator_organization_id_organizations_id_fk" FOREIGN KEY ("generator_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_receiver_organization_id_organizations_id_fk" FOREIGN KEY ("receiver_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_profiles" ADD CONSTRAINT "helper_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_profiles" ADD CONSTRAINT "helper_profiles_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_profiles" ADD CONSTRAINT "helper_profiles_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_roles" ADD CONSTRAINT "platform_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_roles" ADD CONSTRAINT "platform_roles_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_documents" ADD CONSTRAINT "private_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_documents" ADD CONSTRAINT "private_documents_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_delivery_job_id_delivery_jobs_id_fk" FOREIGN KEY ("delivery_job_id") REFERENCES "public"."delivery_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_generator_organization_id_organizations_id_fk" FOREIGN KEY ("generator_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_receiver_organization_id_organizations_id_fk" FOREIGN KEY ("receiver_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_helper_user_id_user_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_safety_incidents" ADD CONSTRAINT "food_safety_incidents_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_safety_incidents" ADD CONSTRAINT "food_safety_incidents_delivery_job_id_delivery_jobs_id_fk" FOREIGN KEY ("delivery_job_id") REFERENCES "public"."delivery_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_safety_incidents" ADD CONSTRAINT "food_safety_incidents_reported_by_user_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_safety_incidents" ADD CONSTRAINT "food_safety_incidents_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_time_idx" ON "audit_events" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_time_idx" ON "audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "custody_events_donation_time_idx" ON "custody_events" USING btree ("donation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "data_requests_user_status_idx" ON "data_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "delivery_jobs_helper_status_idx" ON "delivery_jobs" USING btree ("helper_user_id","status");--> statement-breakpoint
CREATE INDEX "delivery_jobs_receiver_status_idx" ON "delivery_jobs" USING btree ("receiver_organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_jobs_active_helper_uq" ON "delivery_jobs" USING btree ("helper_user_id","donation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "donation_offers_donation_receiver_uq" ON "donation_offers" USING btree ("donation_id","receiver_organization_id");--> statement-breakpoint
CREATE INDEX "donation_offers_receiver_status_idx" ON "donation_offers" USING btree ("receiver_organization_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "donations_generator_status_idx" ON "donations" USING btree ("generator_organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "donations_expiry_status_idx" ON "donations" USING btree ("status","best_before_at");--> statement-breakpoint
CREATE INDEX "donations_receiver_status_idx" ON "donations" USING btree ("receiver_organization_id","status");--> statement-breakpoint
CREATE INDEX "email_outbox_pending_idx" ON "email_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_org_user_uq" ON "organization_memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_user_status_idx" ON "organization_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "organizations_status_area_idx" ON "organizations" USING btree ("status","service_area_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_roles_user_role_uq" ON "platform_roles" USING btree ("user_id","role");--> statement-breakpoint
CREATE INDEX "private_documents_org_idx" ON "private_documents" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "receipts_created_at_idx" ON "delivery_receipts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "food_safety_incidents_donation_status_idx" ON "food_safety_incidents" USING btree ("donation_id","status");--> statement-breakpoint
CREATE INDEX "service_areas_active_idx" ON "service_areas" USING btree ("active");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_cases_status_created_idx" ON "support_cases" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");