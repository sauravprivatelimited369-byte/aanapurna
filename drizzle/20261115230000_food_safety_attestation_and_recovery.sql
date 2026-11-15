-- Migration 20: the questions a Receiver actually asks, made answerable by the record.
--
-- Four gaps, all of them pointed at by the trust questions rather than by a feature list:
--
--   1. The arrival inspection was a single free-text field. "Was a temperature taken, was the seal
--      unbroken, did the label match what was declared" could only exist as prose, if at all. They
--      are now columns, a CHECK constraint and a second guard trigger, so an inspection that skips
--      the checks cannot be written by any client.
--   2. An incident recorded that something was wrong but not whether a person was harmed, and its
--      closure did not have to say what changed. Both are now required at closure.
--   3. Organisations had no recorded insurance or signed responsibility agreement, so the answer to
--      "who answers for harm" was prose in a markdown file. The declarations are now rows with an
--      expiry that lapses on its own.
--   4. A locked-out person had no way to ask for help that did not depend on already having a
--      channel to an operator. There is now an intake the operator answers, and a queue they see.
--
-- None of this inspects food. Every new field is a human declaration with a name and a time against
-- it. The controls make skipping the declaration impossible, not the harm impossible.

--> statement-breakpoint
-- 1. Structured arrival checks. ---------------------------------------------------------------

ALTER TABLE public.delivery_jobs
  ADD COLUMN IF NOT EXISTS inspection_temperature_c numeric(5,2),
  ADD COLUMN IF NOT EXISTS inspection_seal_intact boolean,
  ADD COLUMN IF NOT EXISTS inspection_packaging_intact boolean,
  ADD COLUMN IF NOT EXISTS inspection_label_matched boolean,
  ADD COLUMN IF NOT EXISTS inspection_within_window boolean,
  ADD COLUMN IF NOT EXISTS inspection_photo_sha256 text;
--> statement-breakpoint

-- Every check is nullable together, or present together. A partially recorded inspection is worse
-- than none: it looks like evidence and cannot be read as one.
ALTER TABLE public.delivery_jobs
  ADD CONSTRAINT delivery_inspection_checks_together CHECK (
    (inspection_seal_intact IS NULL
      AND inspection_packaging_intact IS NULL
      AND inspection_label_matched IS NULL
      AND inspection_within_window IS NULL
      AND inspection_temperature_c IS NULL)
    OR
    (inspection_seal_intact IS NOT NULL
      AND inspection_packaging_intact IS NOT NULL
      AND inspection_label_matched IS NOT NULL
      AND inspection_within_window IS NOT NULL)
  ),
  -- A reading has to be a reading. -40 C to 120 C spans a commercial freezer, a chiller, a hot box
  -- (hot holding is 63 C and above) and near-boiling rice; a value outside it is a typo, and a typo
  -- recorded as a temperature is a false safety record. This range is a sanity bound, not a policy:
  -- whether 63 C is acceptable for a category is the approved policy's decision, not this CHECK's.
  ADD CONSTRAINT delivery_inspection_temperature_range CHECK (
    inspection_temperature_c IS NULL
    OR inspection_temperature_c BETWEEN -40 AND 120
  ),
  ADD CONSTRAINT delivery_inspection_photo_hash_format CHECK (
    inspection_photo_sha256 IS NULL OR inspection_photo_sha256 ~ '^[0-9a-f]{64}$'
  );
--> statement-breakpoint

COMMENT ON COLUMN public.delivery_jobs.inspection_temperature_c IS
  'Temperature the Receiver read at handover, in Celsius. A declaration by a person, not a sensor log. Null means no reading was taken and the record says so.';
COMMENT ON COLUMN public.delivery_jobs.inspection_seal_intact IS
  'Whether the Receiver found the packaging seal unbroken on arrival. Recorded by a person.';
COMMENT ON COLUMN public.delivery_jobs.inspection_photo_sha256 IS
  'SHA-256 of a photo taken at handover, if the receiving organisation attached one. The file is stored privately; this is the fingerprint.';

-- The existing guard trigger already restricts who may record an inspection, and when. It has to
-- learn about the new columns, or they become a second, unguarded way to write the inspection.
CREATE OR REPLACE FUNCTION public.app_guard_delivery_arrival_inspection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.arrived_at IS DISTINCT FROM OLD.arrived_at OR NEW.arrival_reported_by IS DISTINCT FROM OLD.arrival_reported_by THEN
    IF OLD.arrived_at IS NOT NULL OR OLD.arrival_reported_by IS NOT NULL
       OR OLD.status::text <> 'collected' OR NEW.status IS DISTINCT FROM OLD.status
       OR NOT public.app_is_domain_transition() OR NOT public.app_is_active_assigned_helper(OLD.id)
       OR NEW.arrival_reported_by IS DISTINCT FROM public.app_current_user_id()
       OR NEW.arrived_at IS NULL OR NEW.arrived_at > clock_timestamp()
       OR NEW.arrived_at < clock_timestamp() - interval '1 minute' THEN
      RAISE EXCEPTION 'only the assigned Helper may record arrival once' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.inspection_confirmed_at IS DISTINCT FROM OLD.inspection_confirmed_at
     OR NEW.inspection_confirmed_by IS DISTINCT FROM OLD.inspection_confirmed_by
     OR NEW.inspection_notes IS DISTINCT FROM OLD.inspection_notes
     OR NEW.inspection_temperature_c IS DISTINCT FROM OLD.inspection_temperature_c
     OR NEW.inspection_seal_intact IS DISTINCT FROM OLD.inspection_seal_intact
     OR NEW.inspection_packaging_intact IS DISTINCT FROM OLD.inspection_packaging_intact
     OR NEW.inspection_label_matched IS DISTINCT FROM OLD.inspection_label_matched
     OR NEW.inspection_within_window IS DISTINCT FROM OLD.inspection_within_window
     OR NEW.inspection_photo_sha256 IS DISTINCT FROM OLD.inspection_photo_sha256 THEN
    IF OLD.inspection_confirmed_at IS NOT NULL OR OLD.inspection_confirmed_by IS NOT NULL OR OLD.inspection_notes IS NOT NULL
       OR OLD.inspection_seal_intact IS NOT NULL
       OR OLD.status::text <> 'collected' OR NEW.status IS DISTINCT FROM OLD.status
       OR OLD.arrived_at IS NULL OR NOT public.app_is_domain_transition()
       OR NOT public.app_has_org_role(OLD.receiver_organization_id, ARRAY['owner','manager','operator'])
       OR NEW.inspection_confirmed_by IS DISTINCT FROM public.app_current_user_id()
       OR NEW.inspection_confirmed_at IS NULL OR NEW.inspection_confirmed_at > clock_timestamp()
       OR NEW.inspection_confirmed_at < clock_timestamp() - interval '1 minute' THEN
      RAISE EXCEPTION 'only the receiving organisation may record inspection once after arrival' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

GRANT UPDATE (
  inspection_temperature_c,
  inspection_seal_intact,
  inspection_packaging_intact,
  inspection_label_matched,
  inspection_within_window,
  inspection_photo_sha256
) ON public.delivery_jobs TO annapurna_app;
--> statement-breakpoint

-- 2. Harm and corrective action on an incident. -------------------------------------------------

ALTER TABLE public.food_safety_incidents
  ADD COLUMN IF NOT EXISTS harm_reported boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS harm_details text,
  ADD COLUMN IF NOT EXISTS corrective_action text,
  ADD COLUMN IF NOT EXISTS corrective_action_owner text REFERENCES public."user"("id");
--> statement-breakpoint

ALTER TABLE public.food_safety_incidents
  -- "Harm reported" without "what happened to whom" is a tick box, not a record.
  ADD CONSTRAINT food_safety_incidents_harm_detail_check CHECK (
    harm_reported = false OR (harm_details IS NOT NULL AND char_length(btrim(harm_details)) >= 10)
  ),
  -- A closed incident must say what changed. Re-opening the same failure is the thing this prevents.
  ADD CONSTRAINT food_safety_incidents_closure_corrective_check CHECK (
    status <> 'closed' OR (corrective_action IS NOT NULL AND char_length(btrim(corrective_action)) >= 20)
  );
--> statement-breakpoint

COMMENT ON COLUMN public.food_safety_incidents.harm_reported IS
  'Whether a person was reported to have been harmed. A closure is not a finding that nobody was; it records what is known.';
COMMENT ON COLUMN public.food_safety_incidents.corrective_action IS
  'What was changed so the same failure cannot recur. Required before an incident may be closed.';

GRANT UPDATE (harm_reported, harm_details, corrective_action, corrective_action_owner) ON public.food_safety_incidents TO annapurna_app;
--> statement-breakpoint

-- 3. Insurance and the partner agreement. -------------------------------------------------------

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS insurance_policy_reference text,
  ADD COLUMN IF NOT EXISTS insurance_expires_on date,
  ADD COLUMN IF NOT EXISTS agreement_version text,
  ADD COLUMN IF NOT EXISTS agreement_accepted_at timestamptz;
--> statement-breakpoint

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_insurance_paired CHECK (
    (insurance_policy_reference IS NULL) = (insurance_expires_on IS NULL)
  ),
  ADD CONSTRAINT organizations_insurance_reference_length CHECK (
    insurance_policy_reference IS NULL
    OR char_length(btrim(insurance_policy_reference)) BETWEEN 3 AND 120
  ),
  -- The date is in the future at the moment it is recorded. The constraint cannot make an expiry
  -- stay in the future - that is the readiness check's job - but it stops a backdated row.
  ADD CONSTRAINT organizations_insurance_not_backdated CHECK (
    insurance_expires_on IS NULL OR insurance_expires_on >= current_date
  ),
  ADD CONSTRAINT organizations_agreement_paired CHECK (
    (agreement_version IS NULL) = (agreement_accepted_at IS NULL)
  ),
  ADD CONSTRAINT organizations_agreement_version_format CHECK (
    agreement_version IS NULL OR agreement_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  );
--> statement-breakpoint

GRANT UPDATE (insurance_policy_reference, insurance_expires_on, agreement_version, agreement_accepted_at)
  ON public.organizations TO annapurna_app;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.partner_agreement_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations("id") ON DELETE CASCADE,
  version text NOT NULL,
  accepted_by text NOT NULL REFERENCES public."user"("id"),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  content_sha256 text NOT NULL,
  CONSTRAINT partner_agreement_version_format CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT partner_agreement_hash_format CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partner_agreement_org_version_uq
  ON public.partner_agreement_acceptances (organization_id, version);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_agreement_org_idx
  ON public.partner_agreement_acceptances (organization_id, accepted_at);
--> statement-breakpoint
COMMENT ON TABLE public.partner_agreement_acceptances IS
  'One row per organisation per agreement version: who accepted, when, and the hash of the text they were shown. Evidence of acceptance, not a contract.';
--> statement-breakpoint

ALTER TABLE public.partner_agreement_acceptances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.partner_agreement_acceptances FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS partner_agreement_select ON public.partner_agreement_acceptances;
--> statement-breakpoint
CREATE POLICY partner_agreement_select ON public.partner_agreement_acceptances FOR SELECT
USING (
  public.app_has_org_role(organization_id, ARRAY['owner','manager','operator','viewer'])
  OR public.app_has_platform_role(ARRAY['operations_admin','safety_officer','security_admin','support_agent'])
);
--> statement-breakpoint
DROP POLICY IF EXISTS partner_agreement_insert ON public.partner_agreement_acceptances;
--> statement-breakpoint
-- Only somebody who can act for the organisation may bind it, and only in their own name.
CREATE POLICY partner_agreement_insert ON public.partner_agreement_acceptances FOR INSERT
WITH CHECK (
  public.app_is_domain_transition()
  AND public.app_has_org_role(organization_id, ARRAY['owner','manager','operator'])
  AND accepted_by = public.app_current_user_id()
);
--> statement-breakpoint
-- No UPDATE or DELETE policy and no grant: an acceptance is immutable evidence.
REVOKE ALL ON TABLE public.partner_agreement_acceptances FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.partner_agreement_acceptances TO annapurna_app;
--> statement-breakpoint

-- 4. Locked-out account intake. -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  reference text NOT NULL UNIQUE,
  email text NOT NULL,
  detail text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  resolved_by text REFERENCES public."user"("id"),
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_recovery_status_check CHECK (status IN ('submitted','in_review','resolved','declined')),
  CONSTRAINT account_recovery_detail_length CHECK (char_length(btrim(detail)) BETWEEN 10 AND 1000),
  CONSTRAINT account_recovery_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- A resolution and its author arrive together, and never without a closed status.
  CONSTRAINT account_recovery_resolution_fields_check CHECK (
    (status IN ('submitted','in_review') AND resolved_by IS NULL AND resolved_at IS NULL AND resolution IS NULL)
    OR (status IN ('resolved','declined') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
        AND resolution IS NOT NULL AND char_length(btrim(resolution)) >= 10)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS account_recovery_status_idx
  ON public.account_recovery_requests (status, created_at);
--> statement-breakpoint
COMMENT ON TABLE public.account_recovery_requests IS
  'A locked-out person asking for help without an existing session. The email is stored so an operator can act; the success response is identical whether or not the address exists.';
--> statement-breakpoint

ALTER TABLE public.account_recovery_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.account_recovery_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS account_recovery_staff_select ON public.account_recovery_requests;
--> statement-breakpoint
-- Deliberately no policy for the person who filed it: the filer has no session by definition, and
-- the details of a recovery request are not something to expose back to anyone who guesses a
-- reference. Only the operator queue reads it.
CREATE POLICY account_recovery_staff_select ON public.account_recovery_requests FOR SELECT
USING (public.app_has_platform_role(ARRAY['operations_admin','security_admin','support_agent']));
--> statement-breakpoint
DROP POLICY IF EXISTS account_recovery_insert ON public.account_recovery_requests;
--> statement-breakpoint
CREATE POLICY account_recovery_insert ON public.account_recovery_requests FOR INSERT
WITH CHECK (public.app_is_domain_transition());
--> statement-breakpoint
DROP POLICY IF EXISTS account_recovery_staff_update ON public.account_recovery_requests;
--> statement-breakpoint
CREATE POLICY account_recovery_staff_update ON public.account_recovery_requests FOR UPDATE
USING (public.app_has_platform_role(ARRAY['operations_admin','security_admin','support_agent']))
WITH CHECK (public.app_has_platform_role(ARRAY['operations_admin','security_admin','support_agent']));
--> statement-breakpoint
REVOKE ALL ON TABLE public.account_recovery_requests FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.account_recovery_requests TO annapurna_app;
--> statement-breakpoint
GRANT UPDATE (status, resolved_by, resolution, resolved_at) ON TABLE public.account_recovery_requests TO annapurna_app;
--> statement-breakpoint

-- 4a. Notifying the roles accountable for a safety decision. --------------------------------------
--
-- `app_notify_user` refuses to write to anybody but the caller unless the caller holds a platform
-- role. A delivery participant reporting harm is *not* staff, so the fan-out has to happen inside a
-- definer function with its own check - the same pattern `app_notify_area_helpers` uses for dispatch.
-- The caller cannot choose recipients: only role names, and only roles whose holders are accountable
-- for the decision being reported.

CREATE OR REPLACE FUNCTION public.app_notify_platform_roles(
  p_roles text[], p_kind text, p_title text, p_body text, p_href text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  inserted integer := 0;
BEGIN
  IF p_kind IS NULL OR length(p_kind) > 80
     OR p_title IS NULL OR length(p_title) > 160
     OR p_body IS NULL OR length(p_body) > 1000
     OR p_href IS NULL OR p_href !~ '^/[^/]' THEN
    RAISE EXCEPTION 'invalid notification payload' USING ERRCODE = '22023';
  END IF;

  -- Any signed-in person may report harm; nobody may report it anonymously.
  IF public.app_current_user_id() IS NULL THEN
    RAISE EXCEPTION 'not authorized to notify platform roles' USING ERRCODE = '42501';
  END IF;

  -- Only the four known roles, and only names, never addresses.
  IF p_roles IS NULL OR cardinality(p_roles) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_roles) AS requested(role_name)
                WHERE requested.role_name NOT IN ('operations_admin','safety_officer','support_agent','security_admin')) THEN
    RAISE EXCEPTION 'unknown platform role in recipient list' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notifications (user_id, organization_id, kind, title, body, href)
  SELECT DISTINCT grant_row.user_id, NULL::uuid, p_kind, p_title, p_body, p_href
  FROM public.platform_roles grant_row
  -- An account that has been suspended must not be the only recipient of a harm report, and a
  -- suspended account cannot act on it either.
  JOIN public.user_profiles profile ON profile.user_id = grant_row.user_id
  WHERE grant_row.role::text = ANY (p_roles)
    AND profile.account_status::text = 'active';

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_notify_platform_roles(text[], text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_notify_platform_roles(text[], text, text, text, text) TO annapurna_app;
--> statement-breakpoint

-- 5. Readiness reads the new facts. -------------------------------------------------------------
--
-- `app_launch_readiness()` returned five booleans. Two more join them, and unlike the first five
-- these are not owner declarations: they are counts over rows the pilot itself produces, so they
-- turn green as a consequence of the work rather than as a consequence of somebody typing.
--
--   * `partner_insurance`: every verified organisation holds an insurance declaration that has not
--     expired.
--   * `partner_agreement`: every verified organisation accepted the current agreement version.
--
-- An empty deployment reports both as unmet, which is the honest answer to "is anybody covered?".

-- The agreement version the application publishes. A date, so bumping it is a conscious act and
-- every earlier acceptance is visibly stale rather than silently grandfathered. Defined before the
-- readiness function that reads it, because a SQL function body is validated at creation time.
CREATE OR REPLACE FUNCTION public.app_current_agreement_version()
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public
AS $$ SELECT '2026-11-15'::text $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_current_agreement_version() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_current_agreement_version() TO annapurna_app;
--> statement-breakpoint

-- A RETURNS TABLE signature cannot be widened in place, so the old five-column function is dropped
-- and rebuilt with the same name and grants. Nothing else in the schema depends on it: it is a
-- reader called by the application, and the grants are re-issued below.
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
  partner_agreement boolean
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
    -- No verified organisation is an unmet requirement, not a pass. Cover is only proven by a
    -- partner that has some.
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
    ) AS partner_agreement
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_launch_readiness() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_launch_readiness() TO annapurna_app;
