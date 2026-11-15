-- Migration 28: let the sign-in service use the second-factor table it was given.
--
-- Found while proving migration 27 end to end, by doing what a real operator has to do first: enrol an
-- authenticator app. It could not be done, by anybody, on any deployment.
--
-- The two-factor migration granted the sign-in role full DML on `public.two_factor`, then enabled
-- row-level security with a single policy - SELECT only, `user_id = app_current_user_id()` - and a
-- comment saying the sign-in role "bypasses the policy by owning the flow". It does not. Row-level
-- security is skipped only for a table's owner, and the sign-in role has never owned this table. So for
-- that role:
--
--   SELECT / UPDATE  ->  permission denied for function app_current_user_id   (it may not run it)
--   INSERT           ->  new row violates row-level security policy           (no policy admits it)
--
-- which is every statement the enrolment and sign-in flows make. The application requires an account
-- holding a platform role to have a second factor before it serves that account at all, so the effect
-- was not "two-factor is unavailable": it was that no operator could use the product. Nothing noticed
-- because nothing had tried - the existing checks read the privilege table, and the privilege was there.
--
-- The fix is the policy the original comment assumed existed. It admits exactly one role, and that role
-- already holds every table privilege here by design.

-- The owner-only rule was written for the web role, as defence in depth should it ever be granted the
-- table. Scoped to that role so the sign-in role is not asked to evaluate a function it may not run.
ALTER POLICY two_factor_owner_only ON public.two_factor TO annapurna_app;
--> statement-breakpoint
DROP POLICY IF EXISTS two_factor_sign_in_service ON public.two_factor;
--> statement-breakpoint
-- No row predicate, deliberately. The sign-in service looks a factor up by the account that is trying
-- to sign in, before any session exists that could say who is asking; the boundary for this table is
-- which role may connect to it, and that is unchanged: the web role still has no privilege on it at all.
CREATE POLICY two_factor_sign_in_service ON public.two_factor
  FOR ALL TO annapurna_auth
  USING (true)
  WITH CHECK (true);
