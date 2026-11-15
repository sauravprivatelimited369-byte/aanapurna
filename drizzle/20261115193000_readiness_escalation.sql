-- Migration 18: the declarations police themselves.
--
-- Migration 17 made the owner's remaining obligations into records. A record still has a failure
-- mode that no constraint can catch: it quietly stops being true. Insurance lapses, a shift ends,
-- a penetration test ages past a year, and the only thing that notices is a person opening a screen
-- they have no reason to open. That is how "somebody will handle it" comes back.
--
-- This sweep turns the lapse into a notification to the people who can renew it, once per lapse
-- window, so the gap re-announces itself instead of waiting to be discovered. It cannot renew the
-- policy or schedule the shift; it removes the excuse that nobody knew.

--> statement-breakpoint
ALTER TABLE public.platform_attestations
  ADD COLUMN IF NOT EXISTS renewal_reminded_at timestamptz;
--> statement-breakpoint
COMMENT ON COLUMN public.platform_attestations.renewal_reminded_at IS
  'When operations were last told this declaration is lapsing. Cleared whenever the declaration is re-recorded, so a renewal re-arms the reminder.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_escalate_platform_readiness(
  p_horizon_days integer DEFAULT 30
) RETURNS TABLE(expiring_declarations integer, coverage_gaps integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  horizon_days integer := greatest(1, least(coalesce(p_horizon_days, 30), 120));
  declaration record;
  declarations_reported integer := 0;
  gaps_reported integer := 0;
  coverage_missing boolean;
BEGIN
  -- A signed-in caller must be an operations or security human. The background worker has no user
  -- context and is authorised by its EXECUTE grant alone.
  IF public.app_current_user_id() IS NOT NULL
     AND NOT public.app_has_platform_role(ARRAY['operations_admin','security_admin']) THEN
    RAISE EXCEPTION 'not authorized to run readiness escalation' USING ERRCODE = '42501';
  END IF;

  -- Declarations that lapse inside the horizon, or already have. One reminder per lapse window:
  -- re-recording the declaration clears the marker, so a renewal re-arms it.
  FOR declaration IN
    SELECT attestation.key,
           attestation.label,
           attestation.expires_at
    FROM public.platform_attestations attestation
    WHERE attestation.expires_at IS NOT NULL
      AND attestation.expires_at <= clock_timestamp() + make_interval(days => horizon_days)
      AND (attestation.renewal_reminded_at IS NULL
           OR attestation.renewal_reminded_at < clock_timestamp() - make_interval(days => 7))
    ORDER BY attestation.expires_at
    FOR UPDATE
  LOOP
    INSERT INTO public.notifications (user_id, organization_id, kind, title, body, href)
    SELECT DISTINCT role_grant.user_id, NULL::uuid,
      'readiness.declaration_expiring',
      CASE WHEN declaration.expires_at <= clock_timestamp()
        THEN format('%s has lapsed', declaration.label)
        ELSE format('%s expires soon', declaration.label)
      END,
      format('%s is recorded until %s. Launch readiness reports it as unmet once that date passes. Re-record it with the renewed evidence, or the gate stays red.',
        declaration.label,
        to_char(declaration.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
      '/admin#launch-readiness'
    FROM public.platform_roles role_grant
    WHERE role_grant.role::text IN ('operations_admin','security_admin');

    -- Only claim the warning, and only re-arm the reminder, if somebody actually received it. With
    -- no administrator appointed there is nobody to tell, and silently marking the declaration as
    -- "reminded" would bury the lapse instead of reporting it.
    IF FOUND THEN
      UPDATE public.platform_attestations
      SET renewal_reminded_at = clock_timestamp()
      WHERE key = declaration.key;

      declarations_reported := declarations_reported + 1;
    END IF;
  END LOOP;

  -- Coverage for the next twelve hours. Announced at most once every twelve hours, because a rota
  -- gap that repeats every sweep is noise, and noise is what people stop reading.
  coverage_missing := NOT EXISTS (
    SELECT 1 FROM public.on_call_shifts shift
    WHERE shift.ends_at > clock_timestamp()
      AND shift.ends_at - clock_timestamp() >= interval '12 hours'
  );

  IF coverage_missing AND NOT EXISTS (
    SELECT 1 FROM public.notifications notification
    WHERE notification.kind = 'readiness.coverage_gap'
      AND notification.created_at > clock_timestamp() - interval '12 hours'
  ) THEN
    INSERT INTO public.notifications (user_id, organization_id, kind, title, body, href)
    SELECT DISTINCT role_grant.user_id, NULL::uuid,
      'readiness.coverage_gap',
      'Nobody is on call for the next twelve hours',
      'A breach or a safety incident noticed tonight would reach no one. Schedule a shift in the operations console; the support page will not publish a response window until coverage exists.',
      '/admin#launch-readiness'
    FROM public.platform_roles role_grant
    WHERE role_grant.role::text IN ('operations_admin','security_admin');

    IF FOUND THEN
      gaps_reported := 1;
    END IF;
  END IF;

  RETURN QUERY SELECT declarations_reported, gaps_reported;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_escalate_platform_readiness(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_escalate_platform_readiness(integer) TO annapurna_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_escalate_platform_readiness(integer) TO annapurna_worker;
