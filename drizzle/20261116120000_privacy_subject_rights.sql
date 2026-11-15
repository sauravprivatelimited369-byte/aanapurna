-- Migration 22: the three promises migration 21 left as prose.
--
-- Migration 21 made retention real: a sweep runs, holds outrank it, and the audit trail is narrowed
-- rather than weakened. It left three things named as unresolved, and naming a gap is not closing it.
-- This migration closes them, and adds one record that makes them checkable rather than assertable.
--
--   1. Erasure actually erases. Before this, `updateDataRequest` could set a request to `completed`
--      without any redaction ever running, so "your data was erased" was a status string and nothing
--      else. Now a completed erasure must carry the redaction it performed, enforced by CHECK.
--   2. A person receives their data. `app_export_person()` returns exactly the rows the application
--      holds about one account, in one document, and logs the disclosure. Access is not a download
--      button that may or may not work: it is a function that reads a fixed list of tables.
--   3. A person can correct what is theirs. Name and display name become theirs to change, with the
--      change written to the audit trail. Everything else still goes through a reviewed request,
--      because a party's own phone number is not theirs to silently overwrite.
--   4. Grievances have a clock. A data request or support case that passes its response window is
--      visible as overdue, and `app_launch_readiness()` reports it, so an unanswered complaint shows
--      up as red on the operations screen instead of ageing quietly in a table.
--
-- What this deliberately does NOT do: it does not promise a response time. The window is a
-- measurement of how long something has waited, not a service level anybody has agreed to. See the
-- `support_response_window` attestation, which is empty until a rota actually exists.

--> statement-breakpoint
-- 1. An erasure must carry the erasure it performed. ----------------------------------------

ALTER TABLE public.data_requests
  ADD COLUMN IF NOT EXISTS redacted_at timestamptz,
  -- Who ran the redaction. Nullable because a rejected or cancelled request never runs one.
  ADD COLUMN IF NOT EXISTS redacted_by text REFERENCES public."user"(id) ON DELETE SET NULL,
  -- The counts `app_redact_user` returned, kept next to the request so the person can be told what
  -- happened without re-running anything.
  ADD COLUMN IF NOT EXISTS redaction_detail jsonb;
--> statement-breakpoint

-- This is the constraint that turns "completed" from a label into evidence. A request marked
-- completed whose type is erasure must record when the redaction ran. Every other request type is
-- unaffected, and a rejected request never needs a redaction time.
ALTER TABLE public.data_requests
  DROP CONSTRAINT IF EXISTS data_requests_erasure_requires_redaction;
--> statement-breakpoint
ALTER TABLE public.data_requests
  ADD CONSTRAINT data_requests_erasure_requires_redaction CHECK (
    status <> 'completed'
    OR request_type <> 'erasure'
    OR redacted_at IS NOT NULL
  );
--> statement-breakpoint

COMMENT ON COLUMN public.data_requests.redacted_at IS
  'Set when app_redact_user actually ran for this request. A completed erasure without this value is '
  'refused by data_requests_erasure_requires_redaction, so the status cannot outrun the work.';
--> statement-breakpoint

-- 2. The export a person is entitled to. -----------------------------------------------------

-- The document is built from an explicit list of tables. A table added later does not appear in an
-- export until somebody deliberately adds it here, which is the correct default: an export that
-- silently grows to include a new sensitive table is a disclosure nobody approved.
CREATE OR REPLACE FUNCTION public.app_export_person(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  document jsonb;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RAISE EXCEPTION 'app_export_person requires a user id' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT jsonb_build_object(
    'exportedAt', now(),
    'subject', p_user_id,
    'format', 'annapurna-link/data-export@1',
    'about', jsonb_build_object(
      'whatThisIs', 'Every row this application holds that is linked to your account id.',
      'whatThisIsNot', 'It does not include rows that name you only inside free text, and it does not include data held by another system such as your email provider.',
      'howRetentionAffectsIt', 'Rows already past their retention window are gone, so they are not here either.'
    ),
    'account', (
      SELECT to_jsonb(account_row) - 'email_verified' FROM (
        SELECT u.id, u.name, u.email, u.email_verified, u.image, u.requested_role,
               u.two_factor_enabled, u.created_at, u.updated_at
        FROM public."user" u WHERE u.id = p_user_id
      ) account_row
    ),
    'profile', (
      SELECT to_jsonb(profile_row) FROM (
        SELECT p.user_id, p.account_status, p.requested_role, p.display_name, p.created_at, p.updated_at
        FROM public.user_profiles p WHERE p.user_id = p_user_id
      ) profile_row
    ),
    'registrationDetails', (
      SELECT to_jsonb(registration_row) FROM (
        SELECT r.user_id, r.requested_role, r.phone, r.organization_name, r.organization_type,
               r.address_line, r.city_or_district, r.state_or_region, r.postal_code,
               r.profile_notes, r.verification_status, r.created_at
        FROM public.registration_profiles r WHERE r.user_id = p_user_id
      ) registration_row
    ),
    'helperProfile', (
      SELECT to_jsonb(helper_row) FROM (
        SELECT h.user_id, h.status, h.availability_notes, h.training_acknowledged_at,
               h.approved_at, h.created_at
        FROM public.helper_profiles h WHERE h.user_id = p_user_id
      ) helper_row
    ),
    'organizationMemberships', coalesce((
      SELECT jsonb_agg(to_jsonb(membership_row) ORDER BY membership_row.created_at)
      FROM (
        SELECT m.organization_id, o.name AS organization_name, m.role, m.status, m.created_at
        FROM public.organization_memberships m
        JOIN public.organizations o ON o.id = m.organization_id
        WHERE m.user_id = p_user_id
      ) membership_row
    ), '[]'::jsonb),
    'platformRoles', coalesce((
      SELECT jsonb_agg(jsonb_build_object('role', role_row.role, 'reason', role_row.reason, 'granted_at', role_row.created_at) ORDER BY role_row.created_at)
      FROM (SELECT role, reason, created_at FROM public.platform_roles WHERE user_id = p_user_id) role_row
    ), '[]'::jsonb),
    'notifications', coalesce((
      SELECT jsonb_agg(jsonb_build_object('kind', n.kind, 'title', n.title, 'body', n.body, 'read_at', n.read_at, 'created_at', n.created_at) ORDER BY n.created_at DESC)
      FROM public.notifications n WHERE n.user_id = p_user_id
    ), '[]'::jsonb),
    -- The donations a person created or received. Their own record of the food, not the partner's.
    'donationsCreated', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'category', d.category, 'status', d.status,
        'quantity', d.quantity, 'unit', d.unit, 'created_at', d.created_at
      ) ORDER BY d.created_at DESC)
      FROM public.donations d WHERE d.created_by = p_user_id
    ), '[]'::jsonb),
    -- Receipts are the record that accountability happened, so they are included rather than hidden.
    'deliveryReceipts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'reference', r.reference, 'donation_id', r.donation_id, 'quantity', r.quantity,
        'unit', r.unit, 'collected_at', r.collected_at, 'delivered_at', r.delivered_at, 'verified', r.verified
      ) ORDER BY r.created_at DESC)
      FROM public.delivery_receipts r WHERE r.helper_user_id = p_user_id
    ), '[]'::jsonb),
    'custodyEvents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'donation_id', c.donation_id, 'delivery_job_id', c.delivery_job_id,
        'event_type', c.event_type, 'occurred_at', c.occurred_at, 'details', c.details
      ) ORDER BY c.occurred_at DESC)
      FROM public.custody_events c WHERE c.actor_user_id = p_user_id
    ), '[]'::jsonb),
    'supportCases', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'reference', s.reference, 'subject', s.subject, 'description', s.description,
        'status', s.status, 'created_at', s.created_at, 'updated_at', s.updated_at
      ) ORDER BY s.created_at DESC)
      FROM public.support_cases s WHERE s.created_by = p_user_id
    ), '[]'::jsonb),
    'privacyRequests', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'request_type', dr.request_type, 'description', dr.description, 'status', dr.status,
        'resolution', dr.resolution, 'created_at', dr.created_at, 'completed_at', dr.completed_at,
        'redacted_at', dr.redacted_at
      ) ORDER BY dr.created_at DESC)
      FROM public.data_requests dr WHERE dr.user_id = p_user_id
    ), '[]'::jsonb),
    -- The person's own record of what the service did with their data. This is the part that makes
    -- the retention promise checkable by the person it was made to.
    'retentionActions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'category', log.category, 'action', log.action, 'affected_rows', log.affected_rows,
        'skipped_by_hold', log.skipped_by_hold, 'executed_at', log.executed_at
      ) ORDER BY log.executed_at DESC)
      FROM public.data_scrub_log log WHERE log.dry_run = false
    ), '[]'::jsonb),
    'legalHolds', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'scope_type', h.scope_type, 'reason', h.reason, 'placed_at', h.placed_at,
        'released_at', h.released_at
      ) ORDER BY h.placed_at DESC)
      FROM public.retention_holds h
      WHERE h.user_id = p_user_id
         OR h.organization_id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = p_user_id)
    ), '[]'::jsonb)
  ) INTO document;

  IF document -> 'account' = 'null'::jsonb THEN
    RAISE EXCEPTION 'no account exists for %', p_user_id USING ERRCODE = 'no_data_found';
  END IF;

  -- An export is a disclosure, so it is recorded exactly like one.
  INSERT INTO public.audit_events (actor_user_id, action, entity_type, entity_id, details)
  VALUES (p_user_id, 'privacy.export_generated', 'user', p_user_id, jsonb_build_object('format', 'data-export@1'));

  RETURN document;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_export_person(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_export_person(text) TO annapurna_app;
--> statement-breakpoint

COMMENT ON FUNCTION public.app_export_person(text) IS
  'Everything the application holds about one account, as one JSON document, with the disclosure '
  'audited. A new table does not enter the export until somebody adds it here deliberately.';
--> statement-breakpoint

-- 3. Correction: what a person may change without review. -----------------------------------

-- The rule is narrow on purpose. A person's own display name is theirs. Their organisation's legal
-- name, their partner phone number and their verification status are not, because those are the
-- records other people rely on and a silent edit would be indistinguishable from a false claim.
--
-- The grant is column-level, so even a compromised application path cannot update `account_status`
-- or `email` through this role.
GRANT UPDATE (display_name, updated_at) ON TABLE public.user_profiles TO annapurna_app;
--> statement-breakpoint

-- `app_notify_user` already exists for notifications; this records the correction itself so the
-- audit trail explains the change rather than just showing a new value.
CREATE OR REPLACE FUNCTION public.app_record_profile_correction(p_user_id text, p_field text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_field NOT IN ('display_name') THEN
    RAISE EXCEPTION 'field % is not self-service correctable', p_field USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.audit_events (actor_user_id, action, entity_type, entity_id, reason, details)
  VALUES (p_user_id, 'privacy.self_correction', 'user', p_user_id,
          'The account holder corrected their own ' || replace(p_field, '_', ' ') || ' from the profile page.',
          jsonb_build_object('field', p_field));
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_record_profile_correction(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_record_profile_correction(text, text) TO annapurna_app;
--> statement-breakpoint

-- 4. Grievance clocks. -----------------------------------------------------------------------

-- A response window is a measurement, not a promise. `app_overdue_privacy_requests()` counts the
-- requests that have waited longer than the window the operator configured, so "nobody answered this
-- for a month" is a number on a screen rather than a thing a person discovers by complaining twice.
CREATE OR REPLACE FUNCTION public.app_overdue_privacy_requests(p_window_hours integer DEFAULT 72)
RETURNS TABLE (open_requests integer, overdue_requests integer, oldest_open_at timestamptz, oldest_overdue_hours integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    count(*)::integer AS open_requests,
    count(*) FILTER (
      WHERE dr.created_at < now() - make_interval(hours => p_window_hours)
    )::integer AS overdue_requests,
    min(dr.created_at) AS oldest_open_at,
    COALESCE(max(
      floor(extract(epoch FROM (now() - dr.created_at)) / 3600)
    ) FILTER (
      WHERE dr.created_at < now() - make_interval(hours => p_window_hours)
    ), 0)::integer AS oldest_overdue_hours
  FROM public.data_requests dr
  WHERE dr.status IN ('submitted', 'in_review', 'awaiting_user');
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_overdue_privacy_requests(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_overdue_privacy_requests(integer) TO annapurna_app;
--> statement-breakpoint

-- The same question for support cases, because a grievance may arrive as either.
CREATE OR REPLACE FUNCTION public.app_overdue_support_cases(p_window_hours integer DEFAULT 72)
RETURNS TABLE (open_cases integer, overdue_cases integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    count(*)::integer AS open_cases,
    count(*) FILTER (WHERE s.created_at < now() - make_interval(hours => p_window_hours))::integer AS overdue_cases
  FROM public.support_cases s
  WHERE s.status IN ('open', 'in_progress');
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_overdue_support_cases(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_overdue_support_cases(integer) TO annapurna_app;
--> statement-breakpoint

-- The window itself is an operator declaration, because only a person can say how fast a human
-- answers. The key has to be admitted by the CHECK constraint first: adding a key to a table whose
-- allowed set is pinned is a migration, not an insert.
ALTER TABLE public.platform_attestations
  DROP CONSTRAINT IF EXISTS platform_attestations_key_check;
--> statement-breakpoint
ALTER TABLE public.platform_attestations
  ADD CONSTRAINT platform_attestations_key_check CHECK (key IN (
    'legal_entity',
    'insurance',
    'data_protection_contact',
    'penetration_test',
    'support_response_window'
  ));
--> statement-breakpoint

COMMENT ON COLUMN public.platform_attestations.value IS
  'Per-key JSON. legal_entity/insurance/data_protection_contact/penetration_test carry their own '
  'shape; support_response_window carries {"hours": <integer>} and is the only window the grievance '
  'clock measures against. An empty window means nothing has been promised, and readiness says so.';
--> statement-breakpoint

-- A window nobody configured is not a window. It is a boolean the readiness screen can show.
CREATE OR REPLACE FUNCTION public.app_privacy_response_window_hours()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT nullif(a.value ->> 'hours', '')::integer
  FROM public.platform_attestations a
  WHERE a.key = 'support_response_window'
    AND coalesce(a.value ->> 'hours', '') ~ '^[0-9]+$'
  ORDER BY a.recorded_at DESC
  LIMIT 1;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_privacy_response_window_hours() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_privacy_response_window_hours() TO annapurna_app;
--> statement-breakpoint

-- Who is on the other end of that window. A number with no name attached is a claim, not a promise,
-- so the public page publishes both or neither. Restricted to the single free-text field: the
-- attestation row also holds the hours, and a public reader has no business enumerating the rest.
CREATE OR REPLACE FUNCTION public.app_public_response_window_contact()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT nullif(btrim(a.value ->> 'staffedBy'), '')
  FROM public.platform_attestations a
  WHERE a.key = 'support_response_window'
    AND coalesce(btrim(a.value ->> 'staffedBy'), '') <> ''
  ORDER BY a.recorded_at DESC
  LIMIT 1;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_public_response_window_contact() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_public_response_window_contact() TO annapurna_app;
--> statement-breakpoint

-- 5. Readiness learns about the two things that were unmeasurable. ---------------------------

-- A RETURNS TABLE signature cannot be widened in place, so the function is dropped and rebuilt with
-- the same name, the same seven columns in the same order, and two appended. Callers that read by
-- name are unaffected; the grants are re-issued below.
DROP FUNCTION IF EXISTS public.app_launch_readiness();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_launch_readiness()
RETURNS TABLE(
  legal_entity boolean,
  insurance boolean,
  data_protection_contact boolean,
  on_call boolean,
  penetration_test boolean,
  partner_insurance boolean,
  partner_agreement boolean,
  -- Is the person-facing privacy machinery actually wired? A deployment can hold every owner
  -- declaration and still hand a person no way to get their data or to be forgotten.
  subject_rights boolean,
  -- Has anybody answered a complaint inside the window that was configured? No window configured
  -- reads as unmet, because an unconfigured promise cannot be kept.
  grievance_window boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.platform_attestations a
      WHERE a.key = 'legal_entity' AND coalesce(a.value ->> 'entityName', '') <> ''
    ) AS legal_entity,
    EXISTS (
      SELECT 1 FROM public.platform_attestations a
      WHERE a.key = 'insurance'
        AND (a.expires_at IS NULL OR a.expires_at > clock_timestamp())
    ) AS insurance,
    EXISTS (
      SELECT 1 FROM public.platform_attestations a
      WHERE a.key = 'data_protection_contact'
        AND coalesce(a.value ->> 'contactEmail', '') <> ''
    ) AS data_protection_contact,
    EXISTS (
      SELECT 1 FROM public.on_call_shifts s
      WHERE s.ends_at > clock_timestamp()
    ) AS on_call,
    EXISTS (
      SELECT 1 FROM public.platform_attestations a
      WHERE a.key = 'penetration_test'
        AND (a.expires_at IS NULL OR a.expires_at > clock_timestamp())
    ) AS penetration_test,
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.status::text = 'verified')
    AND NOT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.status::text = 'verified'
        AND (o.insurance_policy_reference IS NULL
             OR o.insurance_expires_on IS NULL
             OR o.insurance_expires_on < current_date)
    ) AS partner_insurance,
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.status::text = 'verified')
    AND NOT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.status::text = 'verified'
        AND (o.agreement_version IS NULL
             OR o.agreement_version <> public.app_current_agreement_version())
    ) AS partner_agreement,
    -- Both halves of the promise have to exist: a function that can produce an export, and a
    -- constraint that stops an erasure being marked done without one being performed.
    to_regprocedure('public.app_export_person(text)') IS NOT NULL
    AND to_regprocedure('public.app_redact_user(text,text)') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conname = 'data_requests_erasure_requires_redaction'
        AND c.conrelid = 'public.data_requests'::regclass
    ) AS subject_rights,
    -- A window is configured AND nothing has sat past it.
    public.app_privacy_response_window_hours() IS NOT NULL
    AND (SELECT overdue_requests FROM public.app_overdue_privacy_requests(public.app_privacy_response_window_hours())) = 0
    AND (SELECT overdue_cases FROM public.app_overdue_support_cases(public.app_privacy_response_window_hours())) = 0
    AS grievance_window
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_launch_readiness() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_launch_readiness() TO annapurna_app;
--> statement-breakpoint

-- 6. Access control. -------------------------------------------------------------------------

-- The export reads a person's own rows, so it is called with their identity and the application role
-- only. Nothing here gives a browser a token that can read somebody else.

COMMENT ON COLUMN public.data_requests.redaction_detail IS
  'The counts app_redact_user returned, so a person can be told what was erased without re-running it.';
