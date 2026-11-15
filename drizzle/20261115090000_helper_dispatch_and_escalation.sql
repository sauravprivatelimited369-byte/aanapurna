-- Helper dispatch and backlog escalation.
--
-- Three operational gaps are closed here, all of them about a person who was
-- needed and did not appear:
--
--   1. When a delivery job becomes claimable, approved Helpers in the same
--      service area are now notified instead of having to poll the app.
--   2. An open job that nobody claims (or a claim that expires) is escalated to
--      operations staff once, and partner evidence that is about to expire is
--      escalated the same way.
--   3. Operations can release an uncollected assignment back to `open` with a
--      recorded reason. Before this, an assigned Helper who stopped responding
--      left the food with no path forward except a hold.
--
-- Every new function is SECURITY DEFINER with an explicit caller check, is
-- revoked from PUBLIC, and is granted only to the roles that need it. The new
-- columns are deliberately NOT granted to the application role: only these
-- functions write them.

ALTER TABLE public.delivery_jobs ADD COLUMN IF NOT EXISTS escalated_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE public.private_documents ADD COLUMN IF NOT EXISTS expiry_notified_at timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delivery_jobs_open_escalation_idx
  ON public.delivery_jobs USING btree (status, escalated_at, created_at);
--> statement-breakpoint

-- Allow the donation to return from `assigned` to `reserved` when operations
-- release an uncollected assignment. This mirrors the delivery guard below and
-- is limited to the same platform roles. Nothing else about the state machine
-- changes.
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
      -- Operations released an uncollected assignment back to the reservation.
      OR (OLD.status::text = 'assigned' AND NEW.status::text = 'reserved'
        AND public.app_has_platform_role(ARRAY['operations_admin','safety_officer']))
    ) THEN
      RAISE EXCEPTION 'invalid donation state transition: % to %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Allow one narrow, audited transition that the original guard forbade:
-- operations may return an *uncollected* assignment to the open pool after
-- clearing the Helper. Nothing else about the state machine changes.
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
      -- Operations release of an uncollected assignment: the Helper must have
      -- been cleared and the caller must hold a platform operations role.
      OR (OLD.status::text = 'assigned' AND NEW.status::text = 'open'
        AND NEW.helper_user_id IS NULL
        AND public.app_has_platform_role(ARRAY['operations_admin','safety_officer']))
    ) THEN
      RAISE EXCEPTION 'invalid delivery state transition: % to %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Notify every active, approved Helper in the donation's service area. Called
-- from the domain service when an accepted offer creates a claimable job.
CREATE OR REPLACE FUNCTION public.app_notify_area_helpers(
  p_donation_id uuid, p_kind text, p_title text, p_body text, p_href text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_area uuid;
  target_generator uuid;
  inserted_count integer;
BEGIN
  IF p_donation_id IS NULL OR p_kind IS NULL OR length(p_kind) > 80
     OR p_title IS NULL OR length(p_title) > 160 OR p_body IS NULL OR length(p_body) > 1000
     OR p_href IS NULL OR p_href !~ '^/[^/]' THEN
    RAISE EXCEPTION 'invalid notification payload' USING ERRCODE = '22023';
  END IF;

  SELECT donation.service_area_id, donation.generator_organization_id
    INTO target_area, target_generator
  FROM public.donations donation
  WHERE donation.id = p_donation_id;

  IF target_area IS NULL OR target_generator IS NULL THEN
    RETURN 0;
  END IF;

  IF NOT (
    public.app_has_platform_role(ARRAY['operations_admin','safety_officer'])
    OR public.app_has_org_role(target_generator, ARRAY['owner','manager','operator'])
    OR EXISTS (
      SELECT 1 FROM public.donation_offers offer
      WHERE offer.donation_id = p_donation_id
        AND public.app_has_org_role(offer.receiver_organization_id, ARRAY['owner','manager','operator'])
    )
  ) THEN
    RAISE EXCEPTION 'not authorized to notify area helpers' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notifications (user_id, organization_id, kind, title, body, href)
  SELECT DISTINCT helper.user_id, NULL::uuid, p_kind, p_title, p_body, p_href
  FROM public.helper_profiles helper
  JOIN public.user_profiles profile ON profile.user_id = helper.user_id
  WHERE helper.status::text = 'active'
    AND helper.service_area_id = target_area
    AND profile.account_status::text = 'active'
    AND helper.user_id IS DISTINCT FROM public.app_current_user_id()
  LIMIT 500;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;
--> statement-breakpoint

-- One sweep covers both backlog cases. It is idempotent: each job and each
-- document is reported once, tracked by the two new columns, so a five-minute
-- schedule does not become a notification flood.
CREATE OR REPLACE FUNCTION public.app_escalate_delivery_backlog(
  p_threshold_minutes integer DEFAULT 30,
  p_document_horizon_days integer DEFAULT 14
) RETURNS TABLE(unclaimed_jobs integer, expiring_documents integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  threshold_minutes integer := greatest(5, least(coalesce(p_threshold_minutes, 30), 1440));
  horizon_days integer := greatest(1, least(coalesce(p_document_horizon_days, 14), 120));
  job record;
  document record;
  jobs_reported integer := 0;
  documents_reported integer := 0;
  reporter text;
BEGIN
  -- A signed-in caller must be an operations or safety human. A background
  -- worker has no user context and is authorized by the EXECUTE grant alone.
  IF public.app_current_user_id() IS NOT NULL
     AND NOT public.app_has_platform_role(ARRAY['operations_admin','safety_officer']) THEN
    RAISE EXCEPTION 'not authorized to run backlog escalation' USING ERRCODE = '42501';
  END IF;

  reporter := coalesce(public.app_current_user_id(), 'system:escalation-sweep');

  FOR job IN
    SELECT delivery.id,
           delivery.donation_id,
           delivery.status,
           delivery.created_at,
           delivery.claim_expires_at,
           donation.name AS donation_name,
           donation.pickup_latest_at,
           donation.service_area_id
    FROM public.delivery_jobs delivery
    JOIN public.donations donation ON donation.id = delivery.donation_id
    WHERE delivery.escalated_at IS NULL
      AND (
        (delivery.status::text = 'open'
          AND delivery.created_at <= clock_timestamp() - make_interval(mins => threshold_minutes))
        OR (delivery.status::text = 'assigned'
          AND delivery.claim_expires_at IS NOT NULL
          AND delivery.claim_expires_at <= clock_timestamp())
      )
    ORDER BY delivery.created_at
    LIMIT 200
    FOR UPDATE OF delivery SKIP LOCKED
  LOOP
    UPDATE public.delivery_jobs
    SET escalated_at = clock_timestamp()
    WHERE id = job.id;

    INSERT INTO public.notifications (user_id, organization_id, kind, title, body, href)
    SELECT DISTINCT role_grant.user_id, NULL::uuid, 'delivery.unclaimed',
      CASE WHEN job.status::text = 'assigned'
        THEN 'A claimed delivery has lapsed'
        ELSE 'A delivery is still unclaimed'
      END,
      format('%s has had no active Helper for over %s minutes. Collection closes %s. Reassign it or contact the Generator and Receiver.',
        job.donation_name, threshold_minutes,
        to_char(job.pickup_latest_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')),
      '/app/deliveries/' || job.id::text
    FROM public.platform_roles role_grant
    WHERE role_grant.role::text IN ('operations_admin','safety_officer');

    jobs_reported := jobs_reported + 1;
  END LOOP;

  FOR document IN
    SELECT evidence.id,
           evidence.organization_id,
           evidence.document_type,
           evidence.expires_at,
           organization.name AS organization_name
    FROM public.private_documents evidence
    JOIN public.organizations organization ON organization.id = evidence.organization_id
    WHERE evidence.expires_at IS NOT NULL
      AND evidence.expiry_notified_at IS NULL
      AND evidence.expires_at <= clock_timestamp() + make_interval(days => horizon_days)
      AND organization.status::text IN ('verified','under_review','submitted')
    ORDER BY evidence.expires_at
    LIMIT 200
    FOR UPDATE OF evidence SKIP LOCKED
  LOOP
    UPDATE public.private_documents
    SET expiry_notified_at = clock_timestamp()
    WHERE id = document.id;

    INSERT INTO public.notifications (user_id, organization_id, kind, title, body, href)
    SELECT DISTINCT role_grant.user_id, NULL::uuid, 'organization.document_expiring',
      'Partner evidence is expiring',
      format('%s: %s expires %s. Re-validate before it lapses.',
        document.organization_name, document.document_type,
        to_char(document.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
      '/app/admin'
    FROM public.platform_roles role_grant
    WHERE role_grant.role::text IN ('operations_admin','safety_officer');

    documents_reported := documents_reported + 1;
  END LOOP;

  INSERT INTO public.audit_events (actor_user_id, action, entity_type, entity_id, details)
  VALUES (
    public.app_current_user_id(),
    'operations.backlog_escalated',
    'delivery_backlog',
    reporter,
    jsonb_build_object(
      'unclaimedJobs', jobs_reported,
      'expiringDocuments', documents_reported,
      'thresholdMinutes', threshold_minutes,
      'documentHorizonDays', horizon_days
    )
  );

  RETURN QUERY SELECT jobs_reported, documents_reported;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_notify_area_helpers(uuid,text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_escalate_delivery_backlog(integer,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_notify_area_helpers(uuid,text,text,text,text) TO annapurna_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_escalate_delivery_backlog(integer,integer) TO annapurna_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_escalate_delivery_backlog(integer,integer) TO annapurna_worker;
