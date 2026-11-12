ALTER TABLE "helper_profiles" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "helper_profiles" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "helper_profiles" ADD CONSTRAINT "helper_profiles_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Keep helper decisions auditable while allowing a rejected applicant to resubmit.
CREATE OR REPLACE FUNCTION public.app_guard_helper_approval() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status::text = 'rejected' AND NEW.status::text = 'pending'
       AND NEW.user_id = public.app_current_user_id()
       AND public.app_is_domain_transition()
       AND NEW.reviewed_by IS NULL AND NEW.reviewed_at IS NULL
       AND NEW.approved_by IS NULL AND NEW.approved_at IS NULL THEN
      RETURN NEW;
    END IF;
    IF NOT public.app_is_domain_transition()
       OR NOT public.app_has_platform_role(ARRAY['operations_admin'])
       OR NEW.reviewed_by IS DISTINCT FROM public.app_current_user_id()
       OR NEW.reviewed_at IS NULL THEN
      RAISE EXCEPTION 'only an authorised, audited human operations decision can change Helper status' USING ERRCODE = '42501';
    END IF;
    IF NEW.status::text = 'active' AND (NEW.approved_by IS DISTINCT FROM public.app_current_user_id() OR NEW.approved_at IS NULL) THEN
      RAISE EXCEPTION 'Helper approval requires the approving operations identity and timestamp' USING ERRCODE = '42501';
    END IF;
    IF NEW.status::text <> 'active'
       AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
      RAISE EXCEPTION 'rejection or suspension cannot rewrite Helper approval history' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_guard_policy_version_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.version IS DISTINCT FROM OLD.version
     OR NEW.rules IS DISTINCT FROM OLD.rules
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'policy versions and authored rules are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'approved' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
      RAISE EXCEPTION 'approved food policy versions are immutable' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'draft' OR NEW.status <> 'approved'
       OR NOT public.app_is_domain_transition()
       OR NOT public.app_has_platform_role(ARRAY['safety_officer'])
       OR NEW.created_by IS NULL OR NEW.created_by = public.app_current_user_id()
       OR NEW.approved_by IS DISTINCT FROM public.app_current_user_id()
       OR NEW.approved_at IS NULL OR NEW.effective_from IS NULL THEN
      RAISE EXCEPTION 'food policy approval requires a distinct authorised human reviewer' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.effective_from IS NOT NULL THEN
    RAISE EXCEPTION 'a food policy draft cannot carry approval fields' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER policy_versions_guard_update BEFORE UPDATE ON public.policy_versions
FOR EACH ROW EXECUTE FUNCTION public.app_guard_policy_version_update();--> statement-breakpoint

-- All staff-created user notifications must pass through a narrow authorisation function.
CREATE OR REPLACE FUNCTION public.app_notify_user(
  p_user_id text, p_organization_id uuid, p_kind text, p_title text, p_body text, p_href text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  notification_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR length(p_kind) > 80
     OR p_title IS NULL OR length(p_title) > 160 OR p_body IS NULL OR length(p_body) > 1000
     OR p_href IS NULL OR p_href !~ '^/[^/]' THEN
    RAISE EXCEPTION 'invalid notification payload' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS DISTINCT FROM public.app_current_user_id()
     AND NOT public.app_has_platform_role(ARRAY['operations_admin','safety_officer','support_agent','security_admin']) THEN
    RAISE EXCEPTION 'not authorized to notify this user' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NOT NULL
     AND NOT public.app_has_org_role(p_organization_id, ARRAY['owner','manager','operator','viewer'])
     AND NOT public.app_has_platform_role(ARRAY['operations_admin','safety_officer']) THEN
    RAISE EXCEPTION 'not authorized to notify this organization' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.notifications (user_id, organization_id, kind, title, body, href)
  VALUES (p_user_id, p_organization_id, p_kind, p_title, p_body, p_href)
  RETURNING id INTO notification_id;
  RETURN notification_id;
END;
$$;--> statement-breakpoint

-- Graphile Worker is confined to its own schema and a small, audited email-outbox API.
CREATE OR REPLACE FUNCTION public.app_worker_reserve_outbox_batch(p_max_attempts integer, p_batch_size integer)
RETURNS TABLE(id uuid, recipient text, kind text, encrypted_payload text, attempts integer, message_id text)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH candidates AS (
    SELECT outbox.id
    FROM public.email_outbox outbox
    WHERE outbox.status IN ('pending','processing')
      AND outbox.available_at <= clock_timestamp()
      AND outbox.attempts < greatest(1, least(p_max_attempts, 20))
    ORDER BY outbox.created_at
    LIMIT greatest(1, least(p_batch_size, 100))
    FOR UPDATE SKIP LOCKED
  ), reserved AS (
    UPDATE public.email_outbox outbox
    SET status = 'processing', attempts = outbox.attempts + 1,
        available_at = clock_timestamp() + interval '10 minutes', last_error = NULL
    FROM candidates
    WHERE outbox.id = candidates.id
    RETURNING outbox.id, outbox.recipient, outbox.kind, outbox.encrypted_payload,
      outbox.attempts, outbox.message_id
  )
  SELECT * FROM reserved
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_worker_defer_outbox(p_max_attempts integer, p_delay_minutes integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.email_outbox
  SET status = 'failed', last_error = 'SMTP_NOT_CONFIGURED_MAX_ATTEMPTS', available_at = clock_timestamp()
  WHERE status IN ('pending','processing') AND available_at <= clock_timestamp()
    AND attempts >= greatest(1, least(p_max_attempts, 20));
  UPDATE public.email_outbox
  SET status = 'pending',
      available_at = clock_timestamp() + (greatest(1, least(p_delay_minutes, 1440)) * interval '1 minute'),
      last_error = 'SMTP_NOT_CONFIGURED'
  WHERE status IN ('pending','processing') AND available_at <= clock_timestamp()
    AND attempts < greatest(1, least(p_max_attempts, 20));
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_worker_mark_outbox_sent(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.email_outbox
  SET status = 'sent', sent_at = clock_timestamp(), available_at = clock_timestamp(), last_error = NULL
  WHERE id = p_id AND status = 'processing';
  RETURN FOUND;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_worker_mark_outbox_failed(
  p_id uuid, p_max_attempts integer, p_backoff_seconds integer, p_error_code text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{1,80}$' THEN
    RAISE EXCEPTION 'invalid email outbox error code' USING ERRCODE = '22023';
  END IF;
  UPDATE public.email_outbox outbox
  SET status = CASE WHEN outbox.attempts >= greatest(1, least(p_max_attempts, 20)) THEN 'failed'::public.outbox_status ELSE 'pending'::public.outbox_status END,
      available_at = clock_timestamp() + (greatest(1, least(p_backoff_seconds, 86400)) * interval '1 second'),
      last_error = p_error_code
  WHERE outbox.id = p_id AND outbox.status = 'processing';
  RETURN FOUND;
END;
$$;--> statement-breakpoint

-- Remove default PUBLIC execution and grant only the functions required by each runtime.
REVOKE ALL ON FUNCTION public.app_current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_is_domain_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_has_platform_role(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_has_org_role(uuid,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_helper_is_active_in_area(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_is_active_assigned_helper(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_can_view_donation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_can_view_delivery_job(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_can_view_private_donation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_can_view_private_destination(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_can_upload_org_documents(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_can_create_donation(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_can_create_offer(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_can_create_delivery(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_can_respond_to_donation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_is_donation_creator(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_find_receiver_candidates(uuid,uuid,text,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_notify_organization_members(uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_notify_user(text,uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_constant_time_equals(bytea,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_consume_delivery_code(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_mark_user_verified() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_worker_reserve_outbox_batch(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_worker_defer_outbox(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_worker_mark_outbox_sent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_worker_mark_outbox_failed(uuid,integer,integer,text) FROM PUBLIC;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.app_current_user_id() TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_is_domain_transition() TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_has_platform_role(text[]) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_has_org_role(uuid,text[]) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_helper_is_active_in_area(uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_is_active_assigned_helper(uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_can_view_donation(uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_can_view_delivery_job(uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_can_view_private_donation(uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_can_view_private_destination(uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_can_upload_org_documents(uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_can_create_donation(uuid,uuid,text,text) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_can_create_offer(uuid,uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_can_create_delivery(uuid,uuid,uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_can_respond_to_donation(uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_is_donation_creator(uuid) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_find_receiver_candidates(uuid,uuid,text,numeric,text) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_notify_organization_members(uuid,uuid,text,text,text,text) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_notify_user(text,uuid,text,text,text,text) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_consume_delivery_code(uuid,text) TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_mark_user_verified() TO annapurna_app;
GRANT EXECUTE ON FUNCTION public.app_worker_reserve_outbox_batch(integer,integer) TO annapurna_worker;
GRANT EXECUTE ON FUNCTION public.app_worker_defer_outbox(integer,integer) TO annapurna_worker;
GRANT EXECUTE ON FUNCTION public.app_worker_mark_outbox_sent(uuid) TO annapurna_worker;
GRANT EXECUTE ON FUNCTION public.app_worker_mark_outbox_failed(uuid,integer,integer,text) TO annapurna_worker;--> statement-breakpoint

GRANT USAGE ON SCHEMA drizzle TO annapurna_app;
GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO annapurna_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_outbox FROM annapurna_worker;
REVOKE UPDATE (status, attempts, available_at, last_error, sent_at) ON TABLE public.email_outbox FROM annapurna_worker;
GRANT USAGE ON SCHEMA graphile_worker TO annapurna_worker;
GRANT UPDATE (reviewed_by, reviewed_at) ON TABLE public.helper_profiles TO annapurna_app;
GRANT UPDATE (service_area_id) ON TABLE public.organizations TO annapurna_app;--> statement-breakpoint
DROP POLICY helper_profiles_update ON public.helper_profiles;
CREATE POLICY helper_profiles_update ON public.helper_profiles FOR UPDATE
USING ((user_id = public.app_current_user_id() AND status::text IN ('pending','rejected'))
  OR (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin'])))
WITH CHECK ((user_id = public.app_current_user_id() AND status::text = 'pending')
  OR (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin'])));
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_guard_history_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_guard_donation_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_guard_delivery_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_guard_organization_review() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_guard_helper_approval() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_guard_receipt_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_guard_policy_version_update() FROM PUBLIC;
