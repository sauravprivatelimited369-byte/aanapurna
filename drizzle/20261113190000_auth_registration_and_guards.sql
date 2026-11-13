-- Real registration intake, trusted role guards and explicit account-state protection.
-- This migration is additive: no existing row is rewritten and no policy is weakened.

ALTER TABLE public."user"
  ADD COLUMN "registration_phone" text,
  ADD COLUMN "registration_organization_name" text,
  ADD COLUMN "registration_organization_type" "organization_type",
  ADD COLUMN "registration_address_line" text,
  ADD COLUMN "registration_city_or_district" text,
  ADD COLUMN "registration_state_or_region" text,
  ADD COLUMN "registration_postal_code" text,
  ADD COLUMN "registration_profile_notes" text;
--> statement-breakpoint

-- Better Auth writes enum values into the intake column using its own role.
GRANT USAGE ON TYPE organization_type TO annapurna_auth;
--> statement-breakpoint

CREATE TABLE public.registration_profiles (
  "user_id" text PRIMARY KEY REFERENCES public."user"("id") ON DELETE CASCADE,
  "requested_role" "requested_role" NOT NULL,
  "phone" text NOT NULL,
  "organization_name" text,
  "organization_type" "organization_type",
  "address_line" text NOT NULL,
  "city_or_district" text NOT NULL,
  "state_or_region" text,
  "postal_code" text,
  "profile_notes" text NOT NULL,
  "verification_status" "verification_status" NOT NULL DEFAULT 'submitted',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_profiles_org_fields_check CHECK (
    (requested_role = 'helper' AND organization_name IS NULL AND organization_type IS NULL)
    OR (requested_role IN ('generator', 'receiver')
        AND organization_name IS NOT NULL
        AND organization_type::text = requested_role::text)
  )
);
--> statement-breakpoint
CREATE INDEX registration_profiles_area_idx ON public.registration_profiles USING btree (city_or_district);
--> statement-breakpoint

ALTER TABLE public.registration_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY registration_profiles_select ON public.registration_profiles FOR SELECT
USING (user_id = public.app_current_user_id()
  OR public.app_has_platform_role(ARRAY['operations_admin','support_agent','safety_officer','security_admin']));
--> statement-breakpoint
CREATE POLICY registration_profiles_insert ON public.registration_profiles FOR INSERT
WITH CHECK (user_id = public.app_current_user_id() AND verification_status::text = 'submitted');
--> statement-breakpoint
-- No UPDATE/DELETE policy and no UPDATE/DELETE grant: intake details are immutable
-- for the web application role. Verification decisions need a trusted process.
GRANT SELECT, INSERT ON TABLE public.registration_profiles TO annapurna_app;
--> statement-breakpoint

-- Defense in depth: even if a future grant is widened, the application role
-- cannot activate, suspend or unlock its own account, or mark itself as a demo
-- account. The SECURITY DEFINER function app_mark_user_verified() still can.
CREATE OR REPLACE FUNCTION public.app_guard_user_profile_status() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user = 'annapurna_app' AND (
    NEW.account_status IS DISTINCT FROM OLD.account_status
    OR NEW.demo_account IS DISTINCT FROM OLD.demo_account
  ) THEN
    RAISE EXCEPTION 'account status changes require a trusted server process' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_profiles_guard_status BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.app_guard_user_profile_status();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_guard_user_profile_status() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_guard_user_profile_status() TO annapurna_app;
--> statement-breakpoint

-- A rate limit for resending verification email is enforced in Better Auth's
-- database-backed limiter (see src/lib/auth.ts); no token is stored here.
CREATE INDEX IF NOT EXISTS session_expires_at_idx ON public.session USING btree (expires_at);
