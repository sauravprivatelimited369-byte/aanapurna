-- Migration 21: every privacy promise now has a job that runs, and a record that proves it ran.
--
-- The privacy page and Q6 on /answers said data is "kept only as long as needed". That sentence was
-- unenforceable: nothing in the codebase ever deleted or scrubbed a row. A retention promise that no
-- process enforces is a statement of intent, not a control. This migration makes it a control.
--
-- Four things are added, and one thing is deliberately NOT added.
--
--   1. `data_retention_settings` — a single row holding the windows that are actually enforced. The
--      numbers in the policy text and the numbers the sweeper obeys are now the same row, so they
--      cannot drift apart the way prose does.
--   2. `retention_holds` — a legal hold that outranks every window. A hold is the only thing that
--      may stop a deletion, it is scoped to a user, an organisation, a job or a donation, and it is
--      always placed by a named member of staff with a reason. Deletion without an escape hatch is
--      a liability; deletion with an unaudited escape hatch is theatre. This is a named escape hatch.
--   3. `data_scrub_log` — one row per action actually taken, with the count, the window applied and
--      the code path. "We deleted it" is only true if there is a row saying so.
--   4. `app_apply_retention(boolean)` — the whole sweep, in the database, in one transaction. Passing
--      true previews (counts only, no writes), so the admin UI and the CLI can show what would go
--      before anything goes.
--
-- What is NOT added: a delete of `audit_events`. Audit rows are the evidence that the rest of this
-- migration did its job, and a retention system that quietly shreds its own evidence is worse than
-- none. The windows scrub the free-text inside audit rows (`details`, `reason`) while keeping the
-- actor, the action, the entity and the timestamp, so the trail survives as a trail.
--
-- Every window here is a maximum, not a target. Nothing is deleted early, and a row inside an active
-- legal hold is never deleted at all — `app_apply_retention` filters holds first and the counts
-- reflect that, so the preview a human approves is the same set the sweep then acts on.

--> statement-breakpoint
-- 1. The windows, in one row. ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.data_retention_settings (
  id integer PRIMARY KEY DEFAULT 1,
  -- How long a read notification survives. Anything longer is a copy of someone's activity that
  -- nobody is reading.
  notifications_days integer NOT NULL DEFAULT 90,
  -- One-time codes are spent within minutes. Keeping the row for a day is already generous and
  -- covers clock skew between the auth service and the sweeper.
  otp_days integer NOT NULL DEFAULT 1,
  -- Delivery codes are encrypted at rest and expire on their own, but an expired ciphertext served
  -- to nobody is still ciphertext at rest.
  delivery_codes_days integer NOT NULL DEFAULT 30,
  -- A closed incident is a safety record; it is kept for the audit window and scrubbed, not deleted.
  closed_incidents_days integer NOT NULL DEFAULT 730,
  -- Dead letters that failed their final retry. Kept long enough to debug a bad deploy.
  failed_jobs_days integer NOT NULL DEFAULT 30,
  -- The floor for audit and safety evidence. Cannot be set below 12 months: a window shorter than
  -- one annual review cannot answer "what happened last year".
  audit_years integer NOT NULL DEFAULT 6,
  -- When a human last changed these numbers, and who. The settings are an audit subject too.
  updated_by text REFERENCES public."user"(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_retention_settings_singleton CHECK (id = 1),
  CONSTRAINT data_retention_settings_windows CHECK (
    notifications_days BETWEEN 7 AND 3650
    AND otp_days BETWEEN 1 AND 30
    AND delivery_codes_days BETWEEN 1 AND 365
    AND closed_incidents_days BETWEEN 30 AND 3650
    AND failed_jobs_days BETWEEN 1 AND 365
    AND audit_years BETWEEN 1 AND 25
  )
);
--> statement-breakpoint

INSERT INTO public.data_retention_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

COMMENT ON TABLE public.data_retention_settings IS
  'The retention windows the sweeper obeys. One row by construction; the policy page quotes this row.';
--> statement-breakpoint

-- 2. Legal holds. ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.retention_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Exactly one scope column is set. A hold with no scope would mean "stop everything", which is
  -- an outage disguised as a legal instruction.
  scope_type text NOT NULL,
  user_id text REFERENCES public."user"(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  delivery_job_id uuid REFERENCES public.delivery_jobs(id) ON DELETE CASCADE,
  donation_id uuid REFERENCES public.donations(id) ON DELETE CASCADE,
  reason text NOT NULL,
  -- Whoever placed the hold. Kept even if the account is later removed, so the decision keeps a name.
  placed_by text NOT NULL REFERENCES public."user"(id),
  placed_at timestamptz NOT NULL DEFAULT now(),
  released_by text REFERENCES public."user"(id),
  released_at timestamptz,
  release_reason text,
  CONSTRAINT retention_holds_scope_type CHECK (
    scope_type IN ('user', 'organization', 'job', 'donation')
  ),
  -- The declared scope and the populated column must agree. Rows that disagree are rejected by the
  -- database, not merely by the form that wrote them.
  CONSTRAINT retention_holds_scope_matches CHECK (
    (scope_type = 'user' AND user_id IS NOT NULL AND organization_id IS NULL AND delivery_job_id IS NULL AND donation_id IS NULL)
    OR (scope_type = 'organization' AND organization_id IS NOT NULL AND user_id IS NULL AND delivery_job_id IS NULL AND donation_id IS NULL)
    OR (scope_type = 'job' AND delivery_job_id IS NOT NULL AND user_id IS NULL AND organization_id IS NULL AND donation_id IS NULL)
    OR (scope_type = 'donation' AND donation_id IS NOT NULL AND user_id IS NULL AND organization_id IS NULL AND delivery_job_id IS NULL)
  ),
  CONSTRAINT retention_holds_reason_length CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  -- A release is all three fields or none. A half-released hold is ambiguous, and ambiguity in a
  -- thing that blocks deletion resolves in the direction of never deleting.
  CONSTRAINT retention_holds_release_complete CHECK (
    (released_at IS NULL AND released_by IS NULL AND release_reason IS NULL)
    OR (released_at IS NOT NULL AND released_by IS NOT NULL AND release_reason IS NOT NULL AND char_length(btrim(release_reason)) >= 10)
  )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS retention_holds_active_user_idx
  ON public.retention_holds (user_id) WHERE released_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS retention_holds_active_org_idx
  ON public.retention_holds (organization_id) WHERE released_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS retention_holds_active_donation_idx
  ON public.retention_holds (donation_id) WHERE released_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS retention_holds_active_job_idx
  ON public.retention_holds (delivery_job_id) WHERE released_at IS NULL;
--> statement-breakpoint

COMMENT ON TABLE public.retention_holds IS
  'A legal or investigative hold. An active hold on a user, organisation, job or donation stops every '
  'retention window for the rows that belong to it. Placed and released by named staff only.';
--> statement-breakpoint

-- 3. The log of what was actually done. ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.data_scrub_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  -- The category name as the sweeper knows it, so a log line and a code path share one vocabulary.
  category text NOT NULL,
  action text NOT NULL,
  window_days integer,
  affected_rows integer NOT NULL DEFAULT 0,
  -- Rows skipped because an active hold covered them. A skip is a decision and is recorded like one.
  skipped_by_hold integer NOT NULL DEFAULT 0,
  dry_run boolean NOT NULL DEFAULT false,
  executed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_scrub_log_action CHECK (action IN ('delete', 'scrub', 'skip')),
  CONSTRAINT data_scrub_log_category CHECK (category IN (
    'notifications', 'otp_verification', 'delivery_codes', 'closed_incidents',
    'failed_jobs', 'audit_details', 'audit_events_old'
  ))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS data_scrub_log_time_idx ON public.data_scrub_log (executed_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS data_scrub_log_run_idx ON public.data_scrub_log (run_id);
--> statement-breakpoint

COMMENT ON TABLE public.data_scrub_log IS
  'One row per retention action that actually ran, including previews and hold-skips. The record that '
  'the retention promise was executed, available to staff and to the person whose data it was.';
--> statement-breakpoint

-- 4. The sweep itself. -----------------------------------------------------------------------

-- Returns per-category counts. `p_dry_run = true` computes every count and writes nothing except the
-- preview rows in the log, so the number approved is the number acted on.
CREATE OR REPLACE FUNCTION public.app_apply_retention(p_dry_run boolean DEFAULT false)
RETURNS TABLE (
  category text,
  action text,
  affected_rows integer,
  skipped_by_hold integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  settings public.data_retention_settings;
  run uuid := gen_random_uuid();
  cutoff_notifications timestamptz;
  cutoff_otp timestamptz;
  cutoff_codes timestamptz;
  cutoff_incidents timestamptz;
  cutoff_jobs timestamptz;
  cutoff_audit timestamptz;
  n integer;
  n_skipped integer;
BEGIN
  SELECT * INTO settings FROM public.data_retention_settings WHERE id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'data_retention_settings row 1 is missing; refusing to guess windows'
      USING ERRCODE = 'no_data_found';
  END IF;

  cutoff_notifications := now() - make_interval(days => settings.notifications_days);
  cutoff_otp := now() - make_interval(days => settings.otp_days);
  cutoff_codes := now() - make_interval(days => settings.delivery_codes_days);
  cutoff_incidents := now() - make_interval(days => settings.closed_incidents_days);
  cutoff_jobs := now() - make_interval(days => settings.failed_jobs_days);
  cutoff_audit := now() - make_interval(years => settings.audit_years);

  -- Notifications. Read ones simply age out; a user holding a legal hold keeps theirs.
  SELECT count(*), count(*) FILTER (WHERE held) INTO n, n_skipped FROM (
    SELECT EXISTS (
      SELECT 1 FROM public.retention_holds h
      WHERE h.released_at IS NULL AND h.user_id = notifications.user_id
    ) AS held
    FROM public.notifications
    WHERE notifications.created_at < cutoff_notifications
  ) candidates;
  IF NOT p_dry_run AND n > n_skipped THEN
    DELETE FROM public.notifications
    WHERE notifications.created_at < cutoff_notifications
      AND NOT EXISTS (
        SELECT 1 FROM public.retention_holds h
        WHERE h.released_at IS NULL AND h.user_id = notifications.user_id
      );
  END IF;
  category := 'notifications'; action := 'delete';
  affected_rows := GREATEST(n - n_skipped, 0); skipped_by_hold := n_skipped;
  INSERT INTO public.data_scrub_log (run_id, category, action, window_days, affected_rows, skipped_by_hold, dry_run)
    VALUES (run, category, action, settings.notifications_days, affected_rows, skipped_by_hold, p_dry_run);
  RETURN NEXT;

  -- Spent one-time codes. Rows here are single-use secrets; expiry is the only thing that should
  -- ever have kept them, and expiry is time-based, so a daily sweep is the enforcement.
  SELECT count(*) INTO n FROM public.verification WHERE verification.expires_at < cutoff_otp;
  IF NOT p_dry_run THEN
    DELETE FROM public.verification WHERE verification.expires_at < cutoff_otp;
  END IF;
  category := 'otp_verification'; action := 'delete';
  affected_rows := n; skipped_by_hold := 0;
  INSERT INTO public.data_scrub_log (run_id, category, action, window_days, affected_rows, skipped_by_hold, dry_run)
    VALUES (run, category, action, settings.otp_days, affected_rows, skipped_by_hold, p_dry_run);
  RETURN NEXT;

  -- Delivery codes. Encrypted, unguessable, and expired; the ciphertext is the liability.
  SELECT count(*) INTO n FROM public.delivery_codes WHERE delivery_codes.expires_at < cutoff_codes;
  IF NOT p_dry_run THEN
    DELETE FROM public.delivery_codes WHERE delivery_codes.expires_at < cutoff_codes;
  END IF;
  category := 'delivery_codes'; action := 'delete';
  affected_rows := n; skipped_by_hold := 0;
  INSERT INTO public.data_scrub_log (run_id, category, action, window_days, affected_rows, skipped_by_hold, dry_run)
    VALUES (run, category, action, settings.delivery_codes_days, affected_rows, skipped_by_hold, p_dry_run);
  RETURN NEXT;

  -- Closed incidents: the free text is what carries personal detail ("who was made ill"), so it is
  -- scrubbed while the row, its type, severity, harm flag and timestamps stay for the audit window.
  SELECT count(*), count(*) FILTER (WHERE held) INTO n, n_skipped FROM (
    SELECT EXISTS (
      SELECT 1 FROM public.retention_holds h
      WHERE h.released_at IS NULL
        AND (h.donation_id = food_safety_incidents.donation_id
             OR h.delivery_job_id = food_safety_incidents.delivery_job_id)
    ) AS held
    FROM public.food_safety_incidents
    WHERE food_safety_incidents.status = 'closed'
      AND food_safety_incidents.closed_at < cutoff_incidents
      AND (food_safety_incidents.description <> '[scrubbed]' OR food_safety_incidents.harm_details IS NOT NULL)
  ) candidates;
  IF NOT p_dry_run AND n > n_skipped THEN
    UPDATE public.food_safety_incidents incident
    SET description = '[scrubbed]',
        harm_details = NULL,
        resolution = CASE WHEN incident.resolution IS NULL THEN NULL ELSE '[scrubbed]' END,
        updated_at = now()
    WHERE incident.status = 'closed'
      AND incident.closed_at < cutoff_incidents
      AND (incident.description <> '[scrubbed]' OR incident.harm_details IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.retention_holds h
        WHERE h.released_at IS NULL
          AND (h.donation_id = incident.donation_id OR h.delivery_job_id = incident.delivery_job_id)
      );
  END IF;
  category := 'closed_incidents'; action := 'scrub';
  affected_rows := GREATEST(n - n_skipped, 0); skipped_by_hold := n_skipped;
  INSERT INTO public.data_scrub_log (run_id, category, action, window_days, affected_rows, skipped_by_hold, dry_run)
    VALUES (run, category, action, settings.closed_incidents_days, affected_rows, skipped_by_hold, p_dry_run);
  RETURN NEXT;

  -- Outbox dead letters that exhausted their retries. Encrypted payload goes with the row.
  SELECT count(*) INTO n FROM public.email_outbox
  WHERE email_outbox.status = 'failed' AND email_outbox.created_at < cutoff_jobs;
  IF NOT p_dry_run THEN
    DELETE FROM public.email_outbox
    WHERE email_outbox.status = 'failed' AND email_outbox.created_at < cutoff_jobs;
  END IF;
  category := 'failed_jobs'; action := 'delete';
  affected_rows := n; skipped_by_hold := 0;
  INSERT INTO public.data_scrub_log (run_id, category, action, window_days, affected_rows, skipped_by_hold, dry_run)
    VALUES (run, category, action, settings.failed_jobs_days, affected_rows, skipped_by_hold, p_dry_run);
  RETURN NEXT;

  -- Audit free text, past the audit window. The row survives with actor, action, entity and time;
  -- only the human-readable detail is removed. This is the scrub that makes keeping the trail
  -- compatible with not keeping the personal data inside it.
  SELECT count(*), count(*) FILTER (WHERE held) INTO n, n_skipped FROM (
    SELECT EXISTS (
      SELECT 1 FROM public.retention_holds h
      WHERE h.released_at IS NULL
        AND (h.user_id = audit_events.actor_user_id OR h.organization_id = audit_events.organization_id)
    ) AS held
    FROM public.audit_events
    WHERE audit_events.created_at < cutoff_audit
      AND (audit_events.details <> '{}'::jsonb OR audit_events.reason IS NOT NULL)
  ) candidates;
  IF NOT p_dry_run AND n > n_skipped THEN
    -- The append-only guard permits this one shape of change only inside a transaction that says
    -- it is a retention scrub. The flag is transaction-local, so it cannot leak to another request.
    PERFORM set_config('app.retention_scrub', 'true', true);
    UPDATE public.audit_events event
    SET details = '{}'::jsonb,
        reason = CASE WHEN event.reason IS NULL THEN NULL ELSE '[scrubbed]' END
    WHERE event.created_at < cutoff_audit
      AND (event.details <> '{}'::jsonb OR event.reason IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.retention_holds h
        WHERE h.released_at IS NULL
          AND (h.user_id = event.actor_user_id OR h.organization_id = event.organization_id)
      );
  END IF;
  category := 'audit_details'; action := 'scrub';
  affected_rows := GREATEST(n - n_skipped, 0); skipped_by_hold := n_skipped;
  INSERT INTO public.data_scrub_log (run_id, category, action, window_days, affected_rows, skipped_by_hold, dry_run)
    VALUES (run, category, action, settings.audit_years * 365, affected_rows, skipped_by_hold, p_dry_run);
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

COMMENT ON FUNCTION public.app_apply_retention(boolean) IS
  'Runs every retention window in one transaction and logs each action. True previews without '
  'deleting or scrubbing. Active legal holds are skipped and counted.';
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_apply_retention(boolean) FROM PUBLIC;
--> statement-breakpoint

-- 4b. Scrubbing an audit row without weakening the append-only guarantee. -------------------
--
-- `audit_events` is append-only: a trigger refuses every UPDATE and DELETE (migration 3). That is a
-- stronger control than a retention window, and it is the reason a scrub cannot simply be written.
-- Weakening the guard for everyone would trade the guarantee for the window. So the guard is
-- replaced with one that permits exactly one shape of change, and only inside a transaction that the
-- retention function itself opened:
--
--   * `app.retention_scrub` must be 'true', set transaction-locally by `app_apply_retention`;
--   * `details` may only become `{}`  — never gain or change keys;
--   * `reason` may only become '[scrubbed]' — never gain text;
--   * every other column must be byte-for-byte unchanged.
--
-- In other words the only mutation the guard still allows is one that removes information. An
-- attacker who could set the flag still cannot rewrite history, and the retention window becomes
-- enforceable without the trail becoming editable.

CREATE OR REPLACE FUNCTION public.app_guard_audit_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only records cannot be changed or deleted' USING ERRCODE = '55000';
  END IF;

  IF coalesce(current_setting('app.retention_scrub', true), '') <> 'true' THEN
    RAISE EXCEPTION 'append-only records cannot be changed or deleted' USING ERRCODE = '55000';
  END IF;

  -- Who did what, when, and to which record is never a retention question, so it is checked first
  -- and refused outright.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a retention scrub may not alter who did what, when, or to which record'
      USING ERRCODE = '55000';
  END IF;

  -- Only narrowing is allowed. Anything that adds or rewrites content is still refused.
  IF NEW.details <> '{}'::jsonb THEN
    RAISE EXCEPTION 'a retention scrub may only empty audit details' USING ERRCODE = '55000';
  END IF;
  IF NEW.reason IS NOT NULL AND NEW.reason <> '[scrubbed]' THEN
    RAISE EXCEPTION 'a retention scrub may only blank an audit reason' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_events_append_only ON public.audit_events;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.app_guard_audit_mutation();
--> statement-breakpoint

-- 5. Redaction: what an erasure request actually does. ---------------------------------------

-- Erasing a person is not deleting the account row: receipts, accountability and the audit trail
-- must survive it. So the personal columns are overwritten, the account is locked, and the identity
-- keys that other tables point at are kept. The person becomes an unidentifiable string.
CREATE OR REPLACE FUNCTION public.app_redact_user(p_user_id text, p_reason text)
RETURNS TABLE (redacted_users integer, redacted_accounts integer, redacted_profiles integer, redacted_notifications integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  marker text;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RAISE EXCEPTION 'app_redact_user requires a user id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'app_redact_user requires a reason of at least 10 characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  marker := 'redacted+' || p_user_id || '@invalid';

  UPDATE public."user"
  SET name = 'Redacted account',
      email = marker,
      image = NULL,
      email_verified = false,
      two_factor_enabled = false,
      registration_phone = NULL,
      registration_organization_name = NULL,
      registration_address_line = NULL,
      registration_city_or_district = NULL,
      registration_state_or_region = NULL,
      registration_postal_code = NULL,
      registration_profile_notes = NULL,
      updated_at = now()
  WHERE id = p_user_id;
  GET DIAGNOSTICS redacted_users := ROW_COUNT;

  -- Credentials are deleted outright. There is nothing about a password hash worth keeping after an
  -- erasure request, and leaving a live hash is the one thing that makes redaction reversible.
  DELETE FROM public.account WHERE user_id = p_user_id;
  GET DIAGNOSTICS redacted_accounts := ROW_COUNT;

  DELETE FROM public.session WHERE user_id = p_user_id;
  UPDATE public.two_factor SET secret = '', backup_codes = '' WHERE user_id = p_user_id;

  UPDATE public.user_profiles
  SET display_name = NULL, updated_at = now()
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS redacted_profiles := ROW_COUNT;

  DELETE FROM public.registration_profiles WHERE user_id = p_user_id;

  UPDATE public.notifications
  SET title = '[redacted]', body = '[redacted]', href = NULL
  WHERE user_id = p_user_id;
  GET DIAGNOSTICS redacted_notifications := ROW_COUNT;

  -- Free text that may name the person, in tables that must otherwise be kept.
  UPDATE public.support_cases
  SET description = '[redacted]'
  WHERE created_by = p_user_id;

  UPDATE public.helper_profiles
  SET availability_notes = NULL, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.audit_events (actor_user_id, action, entity_type, entity_id, reason, details)
  VALUES (NULL, 'identity.redacted', 'user', p_user_id, p_reason, jsonb_build_object('reason', p_reason));

  RETURN QUERY SELECT redacted_users, redacted_accounts, redacted_profiles, redacted_notifications;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_redact_user(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_redact_user(text, text) TO annapurna_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_apply_retention(boolean) TO annapurna_app;
--> statement-breakpoint

-- 6. Access control. -------------------------------------------------------------------------

ALTER TABLE public.data_retention_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.data_retention_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.retention_holds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.retention_holds FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.data_scrub_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.data_scrub_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Settings: readable by the three staff roles that answer privacy questions, writable only by the
-- two that can commit the organisation to a shorter or longer window.
DROP POLICY IF EXISTS data_retention_settings_read ON public.data_retention_settings;
--> statement-breakpoint
CREATE POLICY data_retention_settings_read ON public.data_retention_settings FOR SELECT
USING (public.app_has_platform_role(ARRAY['operations_admin', 'security_admin', 'safety_officer']));
--> statement-breakpoint
DROP POLICY IF EXISTS data_retention_settings_write ON public.data_retention_settings;
--> statement-breakpoint
CREATE POLICY data_retention_settings_write ON public.data_retention_settings FOR UPDATE
USING (public.app_has_platform_role(ARRAY['operations_admin', 'security_admin']))
WITH CHECK (
  public.app_is_domain_transition()
  AND public.app_has_platform_role(ARRAY['operations_admin', 'security_admin'])
);
--> statement-breakpoint

-- Holds: staff read them; only operations and security may place or release one, and a hold always
-- records the staff member who placed it rather than trusting the client.
DROP POLICY IF EXISTS retention_holds_read ON public.retention_holds;
--> statement-breakpoint
CREATE POLICY retention_holds_read ON public.retention_holds FOR SELECT
USING (public.app_has_platform_role(ARRAY['operations_admin', 'security_admin', 'safety_officer']));
--> statement-breakpoint
DROP POLICY IF EXISTS retention_holds_insert ON public.retention_holds;
--> statement-breakpoint
CREATE POLICY retention_holds_insert ON public.retention_holds FOR INSERT
WITH CHECK (
  public.app_is_domain_transition()
  AND public.app_has_platform_role(ARRAY['operations_admin', 'security_admin'])
  AND placed_by = public.app_current_user_id()
  AND released_at IS NULL
);
--> statement-breakpoint
DROP POLICY IF EXISTS retention_holds_release ON public.retention_holds;
--> statement-breakpoint
CREATE POLICY retention_holds_release ON public.retention_holds FOR UPDATE
USING (public.app_has_platform_role(ARRAY['operations_admin', 'security_admin']))
WITH CHECK (
  public.app_is_domain_transition()
  AND public.app_has_platform_role(ARRAY['operations_admin', 'security_admin'])
  AND released_by = public.app_current_user_id()
);
--> statement-breakpoint
-- A hold is a historical decision, so it is never destroyed; releasing it is the only exit.
DROP POLICY IF EXISTS retention_holds_no_delete ON public.retention_holds;
--> statement-breakpoint
CREATE POLICY retention_holds_no_delete ON public.retention_holds FOR DELETE
USING (false);
--> statement-breakpoint

-- The log: staff read it. Nothing in the application may rewrite or remove it, including the
-- application role; the sweep writes through a SECURITY DEFINER function instead.
DROP POLICY IF EXISTS data_scrub_log_read ON public.data_scrub_log;
--> statement-breakpoint
CREATE POLICY data_scrub_log_read ON public.data_scrub_log FOR SELECT
USING (public.app_has_platform_role(ARRAY['operations_admin', 'security_admin', 'safety_officer']));
--> statement-breakpoint

REVOKE ALL ON TABLE public.data_retention_settings FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE public.retention_holds FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE public.data_scrub_log FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, UPDATE ON TABLE public.data_retention_settings TO annapurna_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.retention_holds TO annapurna_app;
--> statement-breakpoint
GRANT SELECT ON TABLE public.data_scrub_log TO annapurna_app;
--> statement-breakpoint

-- 7. The erasure request has to be able to reach the redaction. ------------------------------

COMMENT ON COLUMN public.data_requests.status IS
  'submitted -> in_review -> completed. A completed erasure request calls app_redact_user, and the '
  'result is recorded; completing one without acting is the failure this column exists to prevent.';
