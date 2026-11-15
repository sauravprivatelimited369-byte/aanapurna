-- Second factor for privileged accounts.
--
-- The threat model recorded "no second factor" as an accepted residual risk:
-- the strongest control on a platform role was a 12-character password, a
-- revocable session and an audit trail. That is not enough for an account that
-- can release a hold, verify an organisation or reissue a delivery code.
--
-- Better Auth's two-factor plugin supplies TOTP (authenticator app) plus
-- one-time backup codes, with its own failed-attempt counter and lockout. This
-- migration adds the storage and the per-user flag.
--
-- Privileges are deliberately asymmetric:
--   * annapurna_auth  — full DML, because Better Auth owns the enrolment flow.
--   * annapurna_app   — nothing. The shared secret and backup codes never pass
--                       through application code or the browser.
--   * PUBLIC/anon/authenticated — nothing.

ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.two_factor (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  verified boolean NOT NULL DEFAULT true,
  failed_verification_count integer NOT NULL DEFAULT 0,
  locked_until timestamp with time zone
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS two_factor_user_idx ON public.two_factor USING btree (user_id);
--> statement-breakpoint

REVOKE ALL ON TABLE public.two_factor FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.two_factor TO annapurna_auth;
--> statement-breakpoint
REVOKE ALL ON TABLE public.two_factor FROM annapurna_app;
--> statement-breakpoint

-- Defence in depth: even if a future grant is added by mistake, row-level
-- security keeps a tenant from reading another user's secret. The auth role
-- bypasses the policy by owning the flow (RLS is not FORCE'd here), so Better
-- Auth keeps working unchanged.
ALTER TABLE public.two_factor ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS two_factor_owner_only ON public.two_factor;
--> statement-breakpoint
CREATE POLICY two_factor_owner_only ON public.two_factor FOR SELECT
  USING (user_id = public.app_current_user_id());
