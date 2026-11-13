CREATE TABLE "delivery_destination_details" (
	"delivery_job_id" uuid PRIMARY KEY NOT NULL,
	"receiver_name" text NOT NULL,
	"receiver_address" text NOT NULL,
	"receiver_city" text NOT NULL,
	"receiving_contact_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donation_private_details" (
	"donation_id" uuid PRIMARY KEY NOT NULL,
	"private_pickup_address" text NOT NULL,
	"private_pickup_instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "donation_private_details" ("donation_id", "private_pickup_address", "private_pickup_instructions")
SELECT "id", "pickup_address", "pickup_instructions" FROM "donations";
--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "service_area_id" uuid;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "pickup_city" text;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "pickup_state" text;--> statement-breakpoint
UPDATE "donations" AS donation
SET "service_area_id" = organization."service_area_id",
    "pickup_city" = organization."city_or_district",
    "pickup_state" = organization."state_or_region"
FROM "organizations" AS organization
WHERE organization."id" = donation."generator_organization_id";
--> statement-breakpoint
ALTER TABLE "donations" ALTER COLUMN "pickup_city" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_destination_details" ADD CONSTRAINT "delivery_destination_details_delivery_job_id_delivery_jobs_id_fk" FOREIGN KEY ("delivery_job_id") REFERENCES "public"."delivery_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_private_details" ADD CONSTRAINT "donation_private_details_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_service_area_id_service_areas_id_fk" FOREIGN KEY ("service_area_id") REFERENCES "public"."service_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" DROP COLUMN "pickup_address";--> statement-breakpoint
ALTER TABLE "donations" DROP COLUMN "pickup_instructions";
-- Tenant context. The web process sets these transaction-locally through withUserContext().
CREATE OR REPLACE FUNCTION public.app_current_user_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_is_domain_transition() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT coalesce(current_setting('app.domain_transition', true) = 'true', false) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_has_platform_role(p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_roles role_grant
    WHERE role_grant.user_id = public.app_current_user_id()
      AND role_grant.role::text = ANY (p_roles)
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_has_org_role(p_organization_id uuid, p_roles text[] DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships membership
    WHERE membership.organization_id = p_organization_id
      AND membership.user_id = public.app_current_user_id()
      AND membership.status::text = 'active'
      AND (p_roles IS NULL OR membership.role::text = ANY (p_roles))
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_helper_is_active_in_area(p_service_area_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_service_area_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.helper_profiles helper
    JOIN public.service_areas area ON area.id = helper.service_area_id AND area.active
    WHERE helper.user_id = public.app_current_user_id()
      AND helper.status::text = 'active'
      AND helper.service_area_id = p_service_area_id
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_is_active_assigned_helper(p_delivery_job_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_jobs job
    JOIN public.helper_profiles helper ON helper.user_id = job.helper_user_id
    WHERE job.id = p_delivery_job_id
      AND job.helper_user_id = public.app_current_user_id()
      AND helper.status::text = 'active'
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_view_donation(p_donation_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.donations donation
    WHERE donation.id = p_donation_id
      AND (
        public.app_has_org_role(donation.generator_organization_id, ARRAY['owner','manager','operator','viewer'])
        OR (donation.receiver_organization_id IS NOT NULL AND public.app_has_org_role(donation.receiver_organization_id, ARRAY['owner','manager','operator','viewer']))
        OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
        OR EXISTS (
          SELECT 1 FROM public.donation_offers offer
          WHERE offer.donation_id = donation.id
            AND public.app_has_org_role(offer.receiver_organization_id, ARRAY['owner','manager','operator','viewer'])
        )
        OR EXISTS (
          SELECT 1 FROM public.delivery_jobs job
          WHERE job.donation_id = donation.id
            AND (
              public.app_is_active_assigned_helper(job.id)
              OR (public.app_helper_is_active_in_area(donation.service_area_id)
                AND (job.status::text = 'open' OR (job.status::text = 'assigned' AND job.claim_expires_at <= now())))
            )
        )
      )
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_view_delivery_job(p_delivery_job_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_jobs job
    JOIN public.donations donation ON donation.id = job.donation_id
    WHERE job.id = p_delivery_job_id
      AND (
        public.app_has_org_role(job.generator_organization_id, ARRAY['owner','manager','operator','viewer'])
        OR public.app_has_org_role(job.receiver_organization_id, ARRAY['owner','manager','operator','viewer'])
        OR public.app_is_active_assigned_helper(job.id)
        OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
        OR (public.app_helper_is_active_in_area(donation.service_area_id)
          AND (job.status::text = 'open' OR (job.status::text = 'assigned' AND job.claim_expires_at <= now())))
      )
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_view_private_donation(p_donation_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.donations donation
    WHERE donation.id = p_donation_id
      AND (
        public.app_has_org_role(donation.generator_organization_id, ARRAY['owner','manager','operator'])
        OR (donation.receiver_organization_id IS NOT NULL AND public.app_has_org_role(donation.receiver_organization_id, ARRAY['owner','manager','operator']))
        OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
        OR EXISTS (SELECT 1 FROM public.delivery_jobs job WHERE job.donation_id = donation.id AND public.app_is_active_assigned_helper(job.id))
      )
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_view_private_destination(p_delivery_job_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_jobs job
    WHERE job.id = p_delivery_job_id
      AND (
        public.app_has_org_role(job.receiver_organization_id, ARRAY['owner','manager','operator'])
        OR public.app_is_active_assigned_helper(job.id)
        OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
      )
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_upload_org_documents(p_organization_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations organization
    WHERE organization.id = p_organization_id
      AND organization.status::text NOT IN ('rejected','suspended','expired')
      AND (organization.created_by = public.app_current_user_id()
        OR public.app_has_org_role(organization.id, ARRAY['owner','manager','operator']))
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_create_donation(
  p_generator_organization_id uuid, p_service_area_id uuid, p_created_by text, p_status text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_created_by = public.app_current_user_id()
    AND p_status = 'offered'
    AND public.app_has_org_role(p_generator_organization_id, ARRAY['owner','manager','operator'])
    AND EXISTS (
      SELECT 1 FROM public.organizations organization
      JOIN public.service_areas area ON area.id = organization.service_area_id AND area.active
      WHERE organization.id = p_generator_organization_id
        AND organization.type::text = 'generator'
        AND organization.status::text = 'verified'
        AND organization.service_area_id = p_service_area_id
    )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_create_offer(p_donation_id uuid, p_receiver_organization_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.donations donation
    JOIN public.organizations generator ON generator.id = donation.generator_organization_id
    JOIN public.service_areas area ON area.id = donation.service_area_id AND area.active
    JOIN public.organizations receiver ON receiver.id = p_receiver_organization_id
    WHERE donation.id = p_donation_id
      AND donation.status::text = 'offered'
      AND public.app_has_org_role(generator.id, ARRAY['owner','manager','operator'])
      AND generator.status::text = 'verified'
      AND receiver.type::text = 'receiver'
      AND receiver.status::text = 'verified'
      AND receiver.service_area_id = donation.service_area_id
      AND receiver.food_capabilities @> ARRAY[donation.category]::text[]
      AND (receiver.receiving_capacity IS NULL
        OR (receiver.capacity_unit = donation.unit AND receiver.receiving_capacity >= donation.quantity))
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_create_delivery(
  p_donation_id uuid, p_offer_id uuid, p_receiver_organization_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.donation_offers offer
    JOIN public.donations donation ON donation.id = offer.donation_id
    WHERE offer.id = p_offer_id
      AND offer.donation_id = p_donation_id
      AND offer.receiver_organization_id = p_receiver_organization_id
      AND offer.status::text = 'pending'
      AND offer.expires_at > now()
      AND donation.status::text = 'offered'
      AND donation.best_before_at > now()
      AND donation.pickup_latest_at > now()
      AND public.app_has_org_role(p_receiver_organization_id, ARRAY['owner','manager','operator'])
      AND NOT EXISTS (SELECT 1 FROM public.delivery_jobs job WHERE job.donation_id = p_donation_id)
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_respond_to_donation(p_donation_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.donation_offers offer
    WHERE offer.donation_id = p_donation_id
      AND public.app_has_org_role(offer.receiver_organization_id, ARRAY['owner','manager','operator'])
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_is_donation_creator(p_donation_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.donations donation
    WHERE donation.id = p_donation_id
      AND donation.created_by = public.app_current_user_id()
      AND public.app_has_org_role(donation.generator_organization_id, ARRAY['owner','manager','operator'])
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_find_receiver_candidates(
  p_generator_organization_id uuid, p_service_area_id uuid, p_category text, p_quantity numeric, p_unit text
) RETURNS TABLE(id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.app_has_org_role(p_generator_organization_id, ARRAY['owner','manager','operator']) THEN
    RAISE EXCEPTION 'not authorized to match a donation' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.donations donation
    WHERE donation.generator_organization_id = p_generator_organization_id
      AND donation.service_area_id = p_service_area_id
      AND donation.category = p_category
      AND donation.quantity = p_quantity
      AND donation.unit = p_unit
      AND donation.created_by = public.app_current_user_id()
      AND donation.status::text = 'offered'
  ) THEN
    RAISE EXCEPTION 'donation matching context is invalid' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT receiver.id
    FROM public.organizations receiver
    JOIN public.service_areas area ON area.id = receiver.service_area_id AND area.active
    WHERE receiver.type::text = 'receiver'
      AND receiver.status::text = 'verified'
      AND receiver.service_area_id = p_service_area_id
      AND receiver.food_capabilities @> ARRAY[p_category]::text[]
      AND (receiver.receiving_capacity IS NULL
        OR (receiver.capacity_unit = p_unit AND receiver.receiving_capacity >= p_quantity));
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_notify_organization_members(
  p_organization_id uuid, p_donation_id uuid, p_kind text, p_title text, p_body text, p_href text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  inserted_count integer;
BEGIN
  IF p_organization_id IS NULL OR p_kind IS NULL OR length(p_kind) > 80
     OR p_title IS NULL OR length(p_title) > 160 OR p_body IS NULL OR length(p_body) > 1000
     OR p_href IS NULL OR p_href !~ '^/[^/]' THEN
    RAISE EXCEPTION 'invalid notification payload' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    public.app_has_org_role(p_organization_id, ARRAY['owner','manager','operator','viewer'])
    OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
    OR (p_donation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.donations donation
      WHERE donation.id = p_donation_id
        AND (
          (public.app_has_org_role(donation.generator_organization_id, ARRAY['owner','manager','operator'])
            AND EXISTS (SELECT 1 FROM public.donation_offers offer
              WHERE offer.donation_id = donation.id AND offer.receiver_organization_id = p_organization_id))
          OR EXISTS (SELECT 1 FROM public.donation_offers offer
            WHERE offer.donation_id = donation.id
              AND public.app_has_org_role(offer.receiver_organization_id, ARRAY['owner','manager','operator']))
          OR EXISTS (SELECT 1 FROM public.delivery_jobs job
            WHERE job.donation_id = donation.id
              AND public.app_is_active_assigned_helper(job.id)
              AND p_organization_id IN (job.generator_organization_id, job.receiver_organization_id))
        )
    ))
  ) THEN
    RAISE EXCEPTION 'not authorized to notify this organization' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.notifications (user_id, organization_id, kind, title, body, href)
  SELECT DISTINCT recipient.user_id, p_organization_id, p_kind, p_title, p_body, p_href
  FROM (
    SELECT membership.user_id
    FROM public.organization_memberships membership
    WHERE membership.organization_id = p_organization_id AND membership.status::text = 'active'
    UNION
    SELECT organization.created_by
    FROM public.organizations organization
    WHERE organization.id = p_organization_id
  ) recipient;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_constant_time_equals(p_left bytea, p_right bytea) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  byte_index integer;
  difference integer := 0;
BEGIN
  IF octet_length(p_left) <> octet_length(p_right) THEN
    RETURN false;
  END IF;
  IF octet_length(p_left) = 0 THEN
    RETURN true;
  END IF;
  FOR byte_index IN 0 .. octet_length(p_left) - 1 LOOP
    difference := difference | (get_byte(p_left, byte_index) # get_byte(p_right, byte_index));
  END LOOP;
  RETURN difference = 0;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_consume_delivery_code(p_delivery_job_id uuid, p_candidate_hash text)
RETURNS TABLE(result text, attempts_remaining integer, locked boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_user_id text := public.app_current_user_id();
  code_record record;
  candidate bytea;
  next_attempts integer;
  is_locked boolean;
BEGIN
  IF current_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.delivery_jobs job
    JOIN public.helper_profiles helper ON helper.user_id = job.helper_user_id AND helper.status::text = 'active'
    WHERE job.id = p_delivery_job_id
      AND job.helper_user_id = current_user_id
      AND job.status::text = 'collected'
  ) THEN
    RAISE EXCEPTION 'not authorized to verify this delivery' USING ERRCODE = '42501';
  END IF;
  IF p_candidate_hash IS NULL OR p_candidate_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid verification candidate' USING ERRCODE = '22023';
  END IF;
  candidate := decode(p_candidate_hash, 'hex');
  SELECT code.code_hash, code.expires_at, code.attempts, code.locked_at, code.consumed_at
  INTO code_record
  FROM public.delivery_codes code
  WHERE code.delivery_job_id = p_delivery_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unavailable'::text, 0, false;
    RETURN;
  END IF;
  IF code_record.consumed_at IS NOT NULL OR code_record.locked_at IS NOT NULL
     OR code_record.expires_at <= clock_timestamp() OR code_record.attempts >= 5 THEN
    RETURN QUERY SELECT 'unavailable'::text, greatest(5 - code_record.attempts, 0),
      (code_record.locked_at IS NOT NULL OR code_record.attempts >= 5);
    RETURN;
  END IF;
  IF public.app_constant_time_equals(decode(code_record.code_hash, 'hex'), candidate) THEN
    UPDATE public.delivery_codes SET consumed_at = clock_timestamp()
    WHERE delivery_job_id = p_delivery_job_id AND consumed_at IS NULL AND locked_at IS NULL;
    RETURN QUERY SELECT 'verified'::text, 5 - code_record.attempts, false;
    RETURN;
  END IF;
  next_attempts := code_record.attempts + 1;
  is_locked := next_attempts >= 5;
  UPDATE public.delivery_codes
  SET attempts = next_attempts,
      locked_at = CASE WHEN is_locked THEN clock_timestamp() ELSE locked_at END
  WHERE delivery_job_id = p_delivery_job_id;
  RETURN QUERY SELECT 'invalid'::text, greatest(5 - next_attempts, 0), is_locked;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_mark_user_verified() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_user_id text := public.app_current_user_id();
BEGIN
  IF current_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public."user" WHERE id = current_user_id AND email_verified = true
  ) THEN
    RAISE EXCEPTION 'email verification has not been completed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.user_profiles
  SET account_status = 'active', updated_at = clock_timestamp()
  WHERE user_id = current_user_id AND account_status = 'pending';
  IF FOUND THEN
    INSERT INTO public.audit_events (actor_user_id, action, entity_type, entity_id, details)
    VALUES (current_user_id, 'account.email_verified', 'user', current_user_id, '{}'::jsonb);
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_guard_history_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'append-only records cannot be changed or deleted' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.app_guard_history_mutation();
--> statement-breakpoint
CREATE TRIGGER custody_events_append_only BEFORE UPDATE OR DELETE ON public.custody_events
FOR EACH ROW EXECUTE FUNCTION public.app_guard_history_mutation();
--> statement-breakpoint
CREATE TRIGGER delivery_receipts_append_only BEFORE UPDATE OR DELETE ON public.delivery_receipts
FOR EACH ROW EXECUTE FUNCTION public.app_guard_history_mutation();
--> statement-breakpoint
CREATE TRIGGER donation_private_details_append_only BEFORE UPDATE OR DELETE ON public.donation_private_details
FOR EACH ROW EXECUTE FUNCTION public.app_guard_history_mutation();
--> statement-breakpoint
CREATE TRIGGER delivery_destination_details_append_only BEFORE UPDATE OR DELETE ON public.delivery_destination_details
FOR EACH ROW EXECUTE FUNCTION public.app_guard_history_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_guard_donation_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.generator_organization_id IS DISTINCT FROM OLD.generator_organization_id
     OR NEW.service_area_id IS DISTINCT FROM OLD.service_area_id
     OR NEW.pickup_city IS DISTINCT FROM OLD.pickup_city
     OR NEW.pickup_state IS DISTINCT FROM OLD.pickup_state
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.food_type IS DISTINCT FROM OLD.food_type
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.unit IS DISTINCT FROM OLD.unit
     OR NEW.ingredients IS DISTINCT FROM OLD.ingredients
     OR NEW.allergens IS DISTINCT FROM OLD.allergens
     OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at
     OR NEW.packed_at IS DISTINCT FROM OLD.packed_at
     OR NEW.best_before_at IS DISTINCT FROM OLD.best_before_at
     OR NEW.pickup_earliest_at IS DISTINCT FROM OLD.pickup_earliest_at
     OR NEW.pickup_latest_at IS DISTINCT FROM OLD.pickup_latest_at
     OR NEW.storage_instructions IS DISTINCT FROM OLD.storage_instructions
     OR NEW.temperature_requirement IS DISTINCT FROM OLD.temperature_requirement
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    RAISE EXCEPTION 'donation declarations and origin are immutable after publication' USING ERRCODE = '55000';
  END IF;
  IF NEW.quantity > OLD.quantity THEN
    RAISE EXCEPTION 'accepted quantity cannot exceed the original quantity' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.app_is_domain_transition() THEN
      RAISE EXCEPTION 'domain transition context required' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      (OLD.status::text = 'offered' AND NEW.status::text IN ('reserved','on_hold','cancelled','expired'))
      OR (OLD.status::text = 'reserved' AND NEW.status::text IN ('assigned','on_hold','cancelled','expired'))
      OR (OLD.status::text = 'assigned' AND NEW.status::text IN ('collected','on_hold','cancelled','expired'))
      OR (OLD.status::text = 'collected' AND NEW.status::text IN ('delivered','on_hold','recalled'))
      OR (OLD.status::text = 'delivered' AND NEW.status::text = 'recalled')
    ) THEN
      RAISE EXCEPTION 'invalid donation state transition: % to %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER donations_guard_update BEFORE UPDATE ON public.donations
FOR EACH ROW EXECUTE FUNCTION public.app_guard_donation_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_guard_delivery_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.donation_id IS DISTINCT FROM OLD.donation_id
     OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
     OR NEW.generator_organization_id IS DISTINCT FROM OLD.generator_organization_id
     OR NEW.receiver_organization_id IS DISTINCT FROM OLD.receiver_organization_id THEN
    RAISE EXCEPTION 'delivery origin and endpoints are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.app_is_domain_transition() THEN
      RAISE EXCEPTION 'domain transition context required' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      (OLD.status::text = 'open' AND NEW.status::text IN ('assigned','cancelled','on_hold'))
      OR (OLD.status::text = 'assigned' AND NEW.status::text IN ('collected','cancelled','on_hold'))
      OR (OLD.status::text = 'collected' AND NEW.status::text IN ('delivered','refused','on_hold'))
    ) THEN
      RAISE EXCEPTION 'invalid delivery state transition: % to %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER delivery_jobs_guard_update BEFORE UPDATE ON public.delivery_jobs
FOR EACH ROW EXECUTE FUNCTION public.app_guard_delivery_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_guard_organization_review() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.app_is_domain_transition()
       OR NOT public.app_has_platform_role(ARRAY['operations_admin'])
       OR NEW.reviewed_by IS DISTINCT FROM public.app_current_user_id()
       OR NEW.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'only an authorised human operations decision can change verification status' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organizations_review_guard BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.app_guard_organization_review();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_guard_helper_approval() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (NOT public.app_is_domain_transition()
       OR NOT public.app_has_platform_role(ARRAY['operations_admin'])
       OR NEW.approved_by IS DISTINCT FROM public.app_current_user_id()
       OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'only an authorised human operations decision can approve a Helper' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER helper_profiles_approval_guard BEFORE UPDATE ON public.helper_profiles
FOR EACH ROW EXECUTE FUNCTION public.app_guard_helper_approval();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_guard_receipt_insert() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  delivery record;
BEGIN
  SELECT job.status AS job_status, job.helper_user_id, job.collected_at,
         donation.status AS donation_status, donation.quantity, donation.unit,
         job.generator_organization_id, job.receiver_organization_id
  INTO delivery
  FROM public.delivery_jobs job
  JOIN public.donations donation ON donation.id = job.donation_id
  WHERE job.id = NEW.delivery_job_id AND donation.id = NEW.donation_id;
  IF NOT FOUND OR delivery.job_status::text <> 'delivered'
     OR delivery.donation_status::text <> 'delivered'
     OR delivery.helper_user_id <> NEW.helper_user_id
     OR delivery.collected_at IS DISTINCT FROM NEW.collected_at
     OR delivery.quantity::numeric <> NEW.quantity::numeric
     OR delivery.unit <> NEW.unit
     OR delivery.generator_organization_id <> NEW.generator_organization_id
     OR delivery.receiver_organization_id <> NEW.receiver_organization_id
     OR NEW.delivered_at IS NULL OR NEW.verified IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'receipt does not match a verified delivery' USING ERRCODE = '23514';
  END IF;
  IF NOT public.app_is_active_assigned_helper(NEW.delivery_job_id) THEN
    RAISE EXCEPTION 'only the active assigned Helper can create a receipt' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER delivery_receipts_verify BEFORE INSERT ON public.delivery_receipts
FOR EACH ROW EXECUTE FUNCTION public.app_guard_receipt_insert();
--> statement-breakpoint
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helper_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_private_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_destination_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custody_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_safety_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_profiles_select ON public.user_profiles FOR SELECT
USING (user_id = public.app_current_user_id() OR public.app_has_platform_role(ARRAY['operations_admin','support_agent','safety_officer','security_admin']));
--> statement-breakpoint
CREATE POLICY user_profiles_insert ON public.user_profiles FOR INSERT
WITH CHECK (user_id = public.app_current_user_id() AND account_status::text = 'pending');
--> statement-breakpoint
CREATE POLICY user_profiles_update ON public.user_profiles FOR UPDATE
USING (user_id = public.app_current_user_id())
WITH CHECK (user_id = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY platform_roles_select ON public.platform_roles FOR SELECT
USING (user_id = public.app_current_user_id() OR public.app_has_platform_role(ARRAY['security_admin']));
--> statement-breakpoint
CREATE POLICY platform_roles_grant ON public.platform_roles FOR INSERT
WITH CHECK (public.app_has_platform_role(ARRAY['security_admin']));
--> statement-breakpoint
CREATE POLICY platform_roles_revoke ON public.platform_roles FOR DELETE
USING (public.app_has_platform_role(ARRAY['security_admin']));
--> statement-breakpoint
CREATE POLICY service_areas_read ON public.service_areas FOR SELECT
USING (active OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer']));
--> statement-breakpoint
CREATE POLICY service_areas_insert ON public.service_areas FOR INSERT
WITH CHECK (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','safety_officer']));
--> statement-breakpoint
CREATE POLICY service_areas_update ON public.service_areas FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','safety_officer']))
WITH CHECK (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','safety_officer']));
--> statement-breakpoint
CREATE POLICY service_areas_delete ON public.service_areas FOR DELETE
USING (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin']));
--> statement-breakpoint
CREATE POLICY organizations_read ON public.organizations FOR SELECT
USING (created_by = public.app_current_user_id() OR public.app_has_org_role(id, ARRAY['owner','manager','operator','viewer'])
  OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer','support_agent','security_admin']));
--> statement-breakpoint
CREATE POLICY organizations_submit ON public.organizations FOR INSERT
WITH CHECK (created_by = public.app_current_user_id() AND status::text = 'submitted' AND reviewed_by IS NULL AND reviewed_at IS NULL);
--> statement-breakpoint
CREATE POLICY organizations_review ON public.organizations FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin']))
WITH CHECK (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin']));
--> statement-breakpoint
CREATE POLICY organization_memberships_read ON public.organization_memberships FOR SELECT
USING (user_id = public.app_current_user_id() OR public.app_has_org_role(organization_id, ARRAY['owner','manager','operator','viewer'])
  OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer','support_agent','security_admin']));
--> statement-breakpoint
CREATE POLICY organization_memberships_create_owner ON public.organization_memberships FOR INSERT
WITH CHECK (public.app_is_domain_transition() AND user_id = public.app_current_user_id()
  AND role::text = 'owner' AND status::text = 'pending'
  AND EXISTS (SELECT 1 FROM public.organizations organization WHERE organization.id = organization_id AND organization.created_by = public.app_current_user_id()));
--> statement-breakpoint
CREATE POLICY organization_memberships_review ON public.organization_memberships FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin']))
WITH CHECK (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin']));
--> statement-breakpoint
CREATE POLICY helper_profiles_read ON public.helper_profiles FOR SELECT
USING (user_id = public.app_current_user_id() OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer']));
--> statement-breakpoint
CREATE POLICY helper_profiles_create_self ON public.helper_profiles FOR INSERT
WITH CHECK (user_id = public.app_current_user_id() AND status::text = 'pending' AND approved_by IS NULL AND approved_at IS NULL);
--> statement-breakpoint
CREATE POLICY helper_profiles_update ON public.helper_profiles FOR UPDATE
USING ((user_id = public.app_current_user_id() AND status::text = 'pending')
  OR (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin'])))
WITH CHECK ((user_id = public.app_current_user_id() AND status::text = 'pending')
  OR (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin'])));
--> statement-breakpoint
CREATE POLICY donations_read ON public.donations FOR SELECT USING (public.app_can_view_donation(id));
--> statement-breakpoint
CREATE POLICY donations_create ON public.donations FOR INSERT
WITH CHECK (public.app_is_domain_transition() AND public.app_can_create_donation(generator_organization_id, service_area_id, created_by, status::text));
--> statement-breakpoint
CREATE POLICY donations_update ON public.donations FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_can_view_donation(id))
WITH CHECK (public.app_is_domain_transition() AND (
  public.app_has_org_role(generator_organization_id, ARRAY['owner','manager','operator'])
  OR (receiver_organization_id IS NOT NULL AND public.app_has_org_role(receiver_organization_id, ARRAY['owner','manager','operator']))
  OR EXISTS (SELECT 1 FROM public.delivery_jobs job WHERE job.donation_id = id AND public.app_is_active_assigned_helper(job.id))
  OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
));
--> statement-breakpoint
CREATE POLICY donation_private_details_read ON public.donation_private_details FOR SELECT
USING (public.app_can_view_private_donation(donation_id));
--> statement-breakpoint
CREATE POLICY donation_private_details_create ON public.donation_private_details FOR INSERT
WITH CHECK (public.app_is_domain_transition() AND public.app_is_donation_creator(donation_id));
--> statement-breakpoint
CREATE POLICY donation_offers_read ON public.donation_offers FOR SELECT
USING (public.app_can_view_donation(donation_id));
--> statement-breakpoint
CREATE POLICY donation_offers_create ON public.donation_offers FOR INSERT
WITH CHECK (public.app_is_domain_transition() AND public.app_can_create_offer(donation_id, receiver_organization_id));
--> statement-breakpoint
CREATE POLICY donation_offers_update ON public.donation_offers FOR UPDATE
USING (public.app_is_domain_transition() AND (
  public.app_has_org_role(receiver_organization_id, ARRAY['owner','manager','operator'])
  OR public.app_can_respond_to_donation(donation_id)
  OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
))
WITH CHECK (public.app_is_domain_transition() AND (
  public.app_has_org_role(receiver_organization_id, ARRAY['owner','manager','operator'])
  OR public.app_can_respond_to_donation(donation_id)
  OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
));
--> statement-breakpoint
CREATE POLICY delivery_jobs_read ON public.delivery_jobs FOR SELECT USING (public.app_can_view_delivery_job(id));
--> statement-breakpoint
CREATE POLICY delivery_jobs_create ON public.delivery_jobs FOR INSERT
WITH CHECK (public.app_is_domain_transition() AND public.app_can_create_delivery(donation_id, offer_id, receiver_organization_id)
  AND generator_organization_id = (SELECT donation.generator_organization_id FROM public.donations donation WHERE donation.id = donation_id));
--> statement-breakpoint
CREATE POLICY delivery_jobs_update ON public.delivery_jobs FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_can_view_delivery_job(id))
WITH CHECK (public.app_is_domain_transition() AND (
  public.app_has_org_role(generator_organization_id, ARRAY['owner','manager','operator'])
  OR public.app_has_org_role(receiver_organization_id, ARRAY['owner','manager','operator'])
  OR public.app_is_active_assigned_helper(id)
  OR (status::text = 'assigned' AND helper_user_id = public.app_current_user_id()
    AND public.app_helper_is_active_in_area((SELECT donation.service_area_id FROM public.donations donation WHERE donation.id = donation_id)))
  OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
));
--> statement-breakpoint
CREATE POLICY delivery_destination_details_read ON public.delivery_destination_details FOR SELECT
USING (public.app_can_view_private_destination(delivery_job_id));
--> statement-breakpoint
CREATE POLICY delivery_destination_details_create ON public.delivery_destination_details FOR INSERT
WITH CHECK (public.app_is_domain_transition() AND public.app_can_view_private_destination(delivery_job_id));
--> statement-breakpoint
CREATE POLICY delivery_codes_read_receiver ON public.delivery_codes FOR SELECT
USING (EXISTS (SELECT 1 FROM public.delivery_jobs job WHERE job.id = delivery_job_id
  AND (public.app_has_org_role(job.receiver_organization_id, ARRAY['owner','manager','operator'])
    OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer']))));
--> statement-breakpoint
CREATE POLICY delivery_codes_create_helper ON public.delivery_codes FOR INSERT
WITH CHECK (public.app_is_domain_transition() AND public.app_is_active_assigned_helper(delivery_job_id));
--> statement-breakpoint
CREATE POLICY delivery_codes_lock ON public.delivery_codes FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_can_view_delivery_job(delivery_job_id))
WITH CHECK (public.app_is_domain_transition() AND public.app_can_view_delivery_job(delivery_job_id));
--> statement-breakpoint
CREATE POLICY custody_events_read ON public.custody_events FOR SELECT
USING (public.app_can_view_donation(donation_id));
--> statement-breakpoint
CREATE POLICY custody_events_create ON public.custody_events FOR INSERT
WITH CHECK (public.app_is_domain_transition() AND actor_user_id = public.app_current_user_id()
  AND public.app_can_view_donation(donation_id));
--> statement-breakpoint
CREATE POLICY delivery_receipts_read ON public.delivery_receipts FOR SELECT
USING (public.app_can_view_donation(donation_id));
--> statement-breakpoint
CREATE POLICY delivery_receipts_create ON public.delivery_receipts FOR INSERT
WITH CHECK (public.app_is_domain_transition() AND public.app_is_active_assigned_helper(delivery_job_id)
  AND helper_user_id = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY audit_events_read ON public.audit_events FOR SELECT
USING (public.app_has_platform_role(ARRAY['operations_admin','safety_officer','security_admin'])
  OR (organization_id IS NOT NULL AND public.app_has_org_role(organization_id, ARRAY['owner','manager','operator','viewer'])));
--> statement-breakpoint
CREATE POLICY audit_events_create ON public.audit_events FOR INSERT
WITH CHECK (actor_user_id = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY notifications_read_self ON public.notifications FOR SELECT
USING (user_id = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY notifications_create_self ON public.notifications FOR INSERT
WITH CHECK (user_id = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY notifications_update_self ON public.notifications FOR UPDATE
USING (user_id = public.app_current_user_id()) WITH CHECK (user_id = public.app_current_user_id());
--> statement-breakpoint
CREATE POLICY safety_incidents_read ON public.food_safety_incidents FOR SELECT
USING (reported_by = public.app_current_user_id() OR public.app_can_view_donation(donation_id)
  OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer']));
--> statement-breakpoint
CREATE POLICY safety_incidents_create ON public.food_safety_incidents FOR INSERT
WITH CHECK (reported_by = public.app_current_user_id() AND public.app_is_domain_transition()
  AND public.app_can_view_donation(donation_id));
--> statement-breakpoint
CREATE POLICY safety_incidents_update ON public.food_safety_incidents FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','safety_officer']))
WITH CHECK (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','safety_officer']));
--> statement-breakpoint
CREATE POLICY private_documents_read ON public.private_documents FOR SELECT
USING (public.app_can_upload_org_documents(organization_id)
  OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer']));
--> statement-breakpoint
CREATE POLICY private_documents_create ON public.private_documents FOR INSERT
WITH CHECK (uploaded_by = public.app_current_user_id() AND public.app_is_domain_transition()
  AND public.app_can_upload_org_documents(organization_id));
--> statement-breakpoint
CREATE POLICY support_cases_read ON public.support_cases FOR SELECT
USING (created_by = public.app_current_user_id() OR assigned_to = public.app_current_user_id()
  OR (organization_id IS NOT NULL AND public.app_has_org_role(organization_id, ARRAY['owner','manager','operator','viewer']))
  OR public.app_has_platform_role(ARRAY['support_agent','operations_admin','security_admin']));
--> statement-breakpoint
CREATE POLICY support_cases_create ON public.support_cases FOR INSERT
WITH CHECK (created_by = public.app_current_user_id() AND status = 'open'
  AND (organization_id IS NULL OR public.app_has_org_role(organization_id, ARRAY['owner','manager','operator','viewer'])));
--> statement-breakpoint
CREATE POLICY support_cases_update ON public.support_cases FOR UPDATE
USING (created_by = public.app_current_user_id() OR assigned_to = public.app_current_user_id()
  OR public.app_has_platform_role(ARRAY['support_agent','operations_admin']))
WITH CHECK (created_by = public.app_current_user_id() OR assigned_to = public.app_current_user_id()
  OR public.app_has_platform_role(ARRAY['support_agent','operations_admin']));
--> statement-breakpoint
CREATE POLICY data_requests_read ON public.data_requests FOR SELECT
USING (user_id = public.app_current_user_id() OR public.app_has_platform_role(ARRAY['operations_admin','security_admin','support_agent']));
--> statement-breakpoint
CREATE POLICY data_requests_create ON public.data_requests FOR INSERT
WITH CHECK (user_id = public.app_current_user_id() AND status = 'submitted');
--> statement-breakpoint
CREATE POLICY data_requests_update ON public.data_requests FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','security_admin']))
WITH CHECK (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','security_admin']));
--> statement-breakpoint
CREATE POLICY policy_versions_read ON public.policy_versions FOR SELECT
USING (status = 'approved' OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer']));
--> statement-breakpoint
CREATE POLICY policy_versions_create ON public.policy_versions FOR INSERT
WITH CHECK (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['safety_officer','operations_admin'])
  AND status = 'draft' AND approved_by IS NULL AND approved_at IS NULL);
--> statement-breakpoint
CREATE POLICY policy_versions_update ON public.policy_versions FOR UPDATE
USING (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['safety_officer','operations_admin']))
WITH CHECK (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['safety_officer','operations_admin']));
--> statement-breakpoint
CREATE POLICY email_outbox_read_staff ON public.email_outbox FOR SELECT
USING (public.app_has_platform_role(ARRAY['operations_admin','security_admin']));
--> statement-breakpoint
CREATE POLICY email_outbox_create_app ON public.email_outbox FOR INSERT
WITH CHECK (kind IN ('verification','password_reset') AND recipient <> '' AND encrypted_payload LIKE 'v1.%');
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_notify_organization_members(uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_consume_delivery_code(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_mark_user_verified() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_find_receiver_candidates(uuid,uuid,text,numeric,text) FROM PUBLIC;
--> statement-breakpoint
-- Function execution is restricted in the follow-up migration to a reviewed allowlist.
-- Dedicated runtime roles are provisioned by infra/postgres/initdb/001-create-roles.sh.
GRANT USAGE ON TYPE account_status, delivery_status, donation_status, helper_status,
  membership_role, membership_status, offer_status, organization_type, outbox_status,
  platform_role, requested_role, verification_status TO annapurna_app;
GRANT USAGE ON TYPE requested_role TO annapurna_auth;
GRANT USAGE ON TYPE outbox_status TO annapurna_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user", session, account, verification, rate_limit TO annapurna_auth;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE api_rate_limits TO annapurna_app;
GRANT SELECT, INSERT ON TABLE user_profiles TO annapurna_app;
GRANT UPDATE (requested_role, display_name, updated_at) ON TABLE user_profiles TO annapurna_app;
GRANT SELECT ON TABLE platform_roles TO annapurna_app;
GRANT SELECT, INSERT ON TABLE service_areas TO annapurna_app;
GRANT UPDATE (label, country_code, state_or_region, city_or_district, timezone, active) ON TABLE service_areas TO annapurna_app;
GRANT SELECT, INSERT ON TABLE organizations TO annapurna_app;
GRANT UPDATE (status, reviewed_by, review_reason, reviewed_at, updated_at) ON TABLE organizations TO annapurna_app;
GRANT SELECT, INSERT ON TABLE organization_memberships TO annapurna_app;
GRANT UPDATE (status, updated_at) ON TABLE organization_memberships TO annapurna_app;
GRANT SELECT, INSERT ON TABLE helper_profiles TO annapurna_app;
GRANT UPDATE (service_area_id, availability_notes, training_acknowledged_at, updated_at, status, approved_by, approved_at) ON TABLE helper_profiles TO annapurna_app;
GRANT SELECT, INSERT ON TABLE donations TO annapurna_app;
GRANT UPDATE (status, receiver_organization_id, quantity, hold_reason, updated_at) ON TABLE donations TO annapurna_app;
GRANT SELECT, INSERT ON TABLE donation_private_details TO annapurna_app;
GRANT SELECT, INSERT ON TABLE donation_offers TO annapurna_app;
GRANT UPDATE (status, quantity_accepted, response_reason, responded_by, responded_at) ON TABLE donation_offers TO annapurna_app;
GRANT SELECT, INSERT ON TABLE delivery_jobs TO annapurna_app;
GRANT UPDATE (helper_user_id, status, claimed_at, claim_expires_at, collected_at, delivered_at, collection_condition, delivery_condition, exception_reason, updated_at) ON TABLE delivery_jobs TO annapurna_app;
GRANT SELECT, INSERT ON TABLE delivery_destination_details TO annapurna_app;
GRANT SELECT, INSERT ON TABLE delivery_codes TO annapurna_app;
GRANT UPDATE (locked_at) ON TABLE delivery_codes TO annapurna_app;
GRANT SELECT, INSERT ON TABLE custody_events TO annapurna_app;
GRANT SELECT, INSERT ON TABLE delivery_receipts TO annapurna_app;
GRANT SELECT, INSERT ON TABLE audit_events TO annapurna_app;
GRANT SELECT, INSERT ON TABLE notifications TO annapurna_app;
GRANT UPDATE (read_at) ON TABLE notifications TO annapurna_app;
GRANT SELECT, INSERT ON TABLE food_safety_incidents TO annapurna_app;
GRANT UPDATE (status, resolution, closed_by, closed_at, updated_at) ON TABLE food_safety_incidents TO annapurna_app;
GRANT SELECT, INSERT ON TABLE private_documents TO annapurna_app;
GRANT SELECT, INSERT ON TABLE support_cases TO annapurna_app;
GRANT UPDATE (status, assigned_to, updated_at) ON TABLE support_cases TO annapurna_app;
GRANT SELECT, INSERT ON TABLE data_requests TO annapurna_app;
GRANT UPDATE (status, assigned_to, completed_at) ON TABLE data_requests TO annapurna_app;
GRANT SELECT, INSERT ON TABLE policy_versions TO annapurna_app;
GRANT UPDATE (status, rules, approved_by, approved_at, effective_from) ON TABLE policy_versions TO annapurna_app;
GRANT SELECT, INSERT ON TABLE email_outbox TO annapurna_app;
GRANT SELECT, UPDATE (status, attempts, available_at, last_error, sent_at) ON TABLE email_outbox TO annapurna_worker;
--> statement-breakpoint
