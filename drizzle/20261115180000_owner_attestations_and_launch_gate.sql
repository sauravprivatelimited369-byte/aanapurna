-- Migration 17: owner attestations, on-call coverage, and a launch gate that can actually fail.
--
-- The register's last five rows were not code gaps: a legal entity, insurance, a named data-protection
-- contact, a staffed rota and an outside penetration test all need a person to act. What code can do is
-- stop pretending that "somebody will handle it" is a plan. These records make each requirement a fact
-- the application stores, dates, attributes to a named person and re-checks. Until they exist, launch
-- readiness is visibly false, and the operations console says exactly which one is missing.
--
-- Nothing here can create a legal person, an insurer or an auditor. It can refuse to claim they exist.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.platform_attestations (
  key text PRIMARY KEY,
  label text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_reference text,
  recorded_by text REFERENCES public."user"(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT platform_attestations_key_check CHECK (key IN (
    'legal_entity',
    'insurance',
    'data_protection_contact',
    'penetration_test'
  )),
  CONSTRAINT platform_attestations_evidence_check CHECK (evidence_reference IS NULL OR char_length(evidence_reference) BETWEEN 3 AND 500)
);
--> statement-breakpoint
COMMENT ON TABLE public.platform_attestations IS
  'Owner declarations that no code can verify: the legal entity, its insurance, the named data-protection contact and the last independent penetration test. Each row names who declared it and when it must be renewed.';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.on_call_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  channel text NOT NULL,
  notes text,
  created_by text REFERENCES public."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT on_call_shifts_window_check CHECK (ends_at > starts_at),
  CONSTRAINT on_call_shifts_duration_check CHECK (ends_at - starts_at <= interval '14 days'),
  CONSTRAINT on_call_shifts_channel_check CHECK (char_length(channel) BETWEEN 3 AND 200)
);
--> statement-breakpoint
COMMENT ON TABLE public.on_call_shifts IS
  'A staffed rota. A launch requires coverage for the next 24 hours; without a shift the application reports that nobody is on call instead of implying somebody is.';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS on_call_shifts_window_idx ON public.on_call_shifts (starts_at, ends_at);
--> statement-breakpoint

ALTER TABLE public.platform_attestations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.platform_attestations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.on_call_shifts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.on_call_shifts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS platform_attestations_read ON public.platform_attestations;
--> statement-breakpoint
CREATE POLICY platform_attestations_read ON public.platform_attestations FOR SELECT
USING (public.app_has_platform_role(ARRAY['operations_admin','security_admin','safety_officer']));
--> statement-breakpoint
DROP POLICY IF EXISTS platform_attestations_write ON public.platform_attestations;
--> statement-breakpoint
-- Only the two roles that can answer for the organisation may declare these facts.
CREATE POLICY platform_attestations_write ON public.platform_attestations FOR INSERT
WITH CHECK (
  public.app_is_domain_transition()
  AND public.app_has_platform_role(ARRAY['operations_admin','security_admin'])
  AND recorded_by = public.app_current_user_id()
);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_attestations_update ON public.platform_attestations;
--> statement-breakpoint
CREATE POLICY platform_attestations_update ON public.platform_attestations FOR UPDATE
USING (public.app_has_platform_role(ARRAY['operations_admin','security_admin']))
WITH CHECK (
  public.app_is_domain_transition()
  AND public.app_has_platform_role(ARRAY['operations_admin','security_admin'])
  AND recorded_by = public.app_current_user_id()
);
--> statement-breakpoint
DROP POLICY IF EXISTS platform_attestations_delete ON public.platform_attestations;
--> statement-breakpoint
CREATE POLICY platform_attestations_delete ON public.platform_attestations FOR DELETE
USING (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','security_admin']));
--> statement-breakpoint

DROP POLICY IF EXISTS on_call_shifts_read ON public.on_call_shifts;
--> statement-breakpoint
CREATE POLICY on_call_shifts_read ON public.on_call_shifts FOR SELECT
USING (public.app_has_platform_role(ARRAY['operations_admin','security_admin','safety_officer']));
--> statement-breakpoint
DROP POLICY IF EXISTS on_call_shifts_insert ON public.on_call_shifts;
--> statement-breakpoint
CREATE POLICY on_call_shifts_insert ON public.on_call_shifts FOR INSERT
WITH CHECK (
  public.app_is_domain_transition()
  AND public.app_has_platform_role(ARRAY['operations_admin','security_admin'])
);
--> statement-breakpoint
DROP POLICY IF EXISTS on_call_shifts_delete ON public.on_call_shifts;
--> statement-breakpoint
CREATE POLICY on_call_shifts_delete ON public.on_call_shifts FOR DELETE
USING (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','security_admin']));
--> statement-breakpoint

REVOKE ALL ON TABLE public.platform_attestations FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE public.on_call_shifts FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_attestations TO annapurna_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.on_call_shifts TO annapurna_app;
--> statement-breakpoint

-- The one public fact that belongs on the page: who to contact about personal data. It is published
-- only when it has been declared, never inferred.
CREATE OR REPLACE FUNCTION public.app_public_data_protection_contact() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'contactName', attestation.value ->> 'contactName',
    'contactEmail', attestation.value ->> 'contactEmail',
    'hours', attestation.value ->> 'hours',
    'jurisdiction', attestation.value ->> 'jurisdiction',
    'recordedAt', attestation.recorded_at
  )
  FROM public.platform_attestations attestation
  WHERE attestation.key = 'data_protection_contact'
    AND coalesce(attestation.value ->> 'contactEmail', '') <> ''
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_public_data_protection_contact() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_public_data_protection_contact() TO annapurna_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_legal_entity() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'entityName', attestation.value ->> 'entityName',
    'jurisdiction', attestation.value ->> 'jurisdiction',
    'registeredAddress', attestation.value ->> 'registeredAddress',
    'registrationReference', attestation.evidence_reference,
    'recordedAt', attestation.recorded_at
  )
  FROM public.platform_attestations attestation
  WHERE attestation.key = 'legal_entity'
    AND coalesce(attestation.value ->> 'entityName', '') <> ''
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_legal_entity() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_legal_entity() TO annapurna_app;
--> statement-breakpoint

-- Readiness as five booleans, no values. The health endpoint is public, so it may say *which*
-- requirement is unmet but never what the policy number or the contact's address is.
CREATE OR REPLACE FUNCTION public.app_launch_readiness() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'legal_entity', EXISTS (
      SELECT 1 FROM public.platform_attestations a
      WHERE a.key = 'legal_entity' AND coalesce(a.value ->> 'entityName', '') <> ''
    ),
    'insurance', EXISTS (
      SELECT 1 FROM public.platform_attestations a
      WHERE a.key = 'insurance'
        AND coalesce(a.value ->> 'policyReference', '') <> ''
        AND a.expires_at IS NOT NULL
        AND a.expires_at > now()
    ),
    'data_protection_contact', EXISTS (
      SELECT 1 FROM public.platform_attestations a
      WHERE a.key = 'data_protection_contact'
        AND coalesce(a.value ->> 'contactName', '') <> ''
        AND coalesce(a.value ->> 'contactEmail', '') <> ''
    ),
    -- Coverage now, and coverage that lasts at least half a day: a shift ending in ten minutes
    -- is not a rota.
    'on_call', EXISTS (
      SELECT 1 FROM public.on_call_shifts s
      WHERE s.starts_at <= now() AND s.ends_at > now()
    ) AND EXISTS (
      SELECT 1 FROM public.on_call_shifts s
      WHERE s.ends_at > now() AND s.ends_at - now() >= interval '12 hours'
    ),
    'penetration_test', EXISTS (
      SELECT 1 FROM public.platform_attestations a
      WHERE a.key = 'penetration_test'
        AND coalesce(a.value ->> 'reportReference', '') <> ''
        AND (a.value ->> 'completedOn') ~ '^\d{4}-\d{2}-\d{2}$'
        AND (a.value ->> 'completedOn')::date >= current_date - interval '365 days'
    )
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_launch_readiness() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_launch_readiness() TO annapurna_app;
--> statement-breakpoint

-- Resolve the person on a rota entry without granting the application role sight of the account
-- table. It returns an id or nothing: not an address, not a name, not a list.
CREATE OR REPLACE FUNCTION public.app_on_call_person(p_email text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT account.id
  FROM public."user" account
  WHERE lower(account.email) = lower(btrim(p_email))
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_on_call_person(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_on_call_person(text) TO annapurna_app;
--> statement-breakpoint

-- How much coverage actually exists right now, and for how long. This is what the support page
-- needs to publish a response window honestly: an unpaid promise in a config file is not a rota.
CREATE OR REPLACE FUNCTION public.app_on_call_coverage() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'coveredNow', EXISTS (
      SELECT 1 FROM public.on_call_shifts s WHERE s.starts_at <= now() AND s.ends_at > now()
    ),
    'hoursAhead', coalesce((
      SELECT floor(extract(epoch FROM max(s.ends_at) - now()) / 3600)::int
      FROM public.on_call_shifts s WHERE s.ends_at > now()
    ), 0)
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_on_call_coverage() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_on_call_coverage() TO annapurna_app;
