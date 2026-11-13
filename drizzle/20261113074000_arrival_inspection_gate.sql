-- Record declarations, not independent certification of food safety.
ALTER TABLE public.delivery_jobs ADD COLUMN arrived_at timestamptz;
ALTER TABLE public.delivery_jobs ADD COLUMN arrival_reported_by text REFERENCES public."user"(id);
ALTER TABLE public.delivery_jobs ADD COLUMN inspection_confirmed_at timestamptz;
ALTER TABLE public.delivery_jobs ADD COLUMN inspection_confirmed_by text REFERENCES public."user"(id);
ALTER TABLE public.delivery_jobs ADD COLUMN inspection_notes text;
--> statement-breakpoint
ALTER TABLE public.delivery_jobs ADD CONSTRAINT delivery_arrival_fields_check CHECK (
  (arrived_at IS NULL AND arrival_reported_by IS NULL) OR
  (arrived_at IS NOT NULL AND arrival_reported_by IS NOT NULL AND collected_at IS NOT NULL AND arrived_at >= collected_at)
);
ALTER TABLE public.delivery_jobs ADD CONSTRAINT delivery_inspection_fields_check CHECK (
  (inspection_confirmed_at IS NULL AND inspection_confirmed_by IS NULL AND inspection_notes IS NULL) OR
  (inspection_confirmed_at IS NOT NULL AND inspection_confirmed_by IS NOT NULL AND arrived_at IS NOT NULL
   AND inspection_confirmed_at >= arrived_at AND inspection_notes IS NOT NULL
   AND length(trim(inspection_notes)) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE FUNCTION public.app_guard_delivery_arrival_inspection() RETURNS trigger
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
     OR NEW.inspection_notes IS DISTINCT FROM OLD.inspection_notes THEN
    IF OLD.inspection_confirmed_at IS NOT NULL OR OLD.inspection_confirmed_by IS NOT NULL OR OLD.inspection_notes IS NOT NULL
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
CREATE TRIGGER delivery_arrival_inspection_guard BEFORE UPDATE ON public.delivery_jobs
FOR EACH ROW EXECUTE FUNCTION public.app_guard_delivery_arrival_inspection();
REVOKE ALL ON FUNCTION public.app_guard_delivery_arrival_inspection() FROM PUBLIC;
GRANT UPDATE (arrived_at, arrival_reported_by, inspection_confirmed_at, inspection_confirmed_by, inspection_notes) ON public.delivery_jobs TO annapurna_app;
--> statement-breakpoint
-- Only the receiving organisation can read active code records after arrival and inspection.
-- Platform staff and Helpers cannot read OTP material.
DROP POLICY delivery_codes_read_receiver ON public.delivery_codes;
CREATE POLICY delivery_codes_read_receiver ON public.delivery_codes FOR SELECT
USING (consumed_at IS NULL AND locked_at IS NULL AND expires_at > now()
  AND EXISTS (SELECT 1 FROM public.delivery_jobs job WHERE job.id = delivery_job_id
  AND job.status::text = 'collected' AND job.arrived_at IS NOT NULL AND job.inspection_confirmed_at IS NOT NULL
  AND public.app_has_org_role(job.receiver_organization_id, ARRAY['owner','manager','operator'])));

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_consume_delivery_code(p_delivery_job_id uuid, p_candidate_hash text)
RETURNS TABLE(result text, attempts_remaining integer, locked boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_user_id text := public.app_current_user_id();
  code_record record;
  candidate bytea;
  next_attempts integer;
  is_locked boolean;
BEGIN
  IF current_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.delivery_jobs job
    JOIN public.helper_profiles helper ON helper.user_id = job.helper_user_id AND helper.status::text = 'active'
    WHERE job.id = p_delivery_job_id
      AND job.helper_user_id = current_user_id
      AND job.status::text = 'collected'
      AND job.arrived_at IS NOT NULL AND job.inspection_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'not authorized to verify this delivery' USING ERRCODE = '42501';
  END IF;
  IF p_candidate_hash IS NULL OR p_candidate_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid verification candidate' USING ERRCODE = '22023';
  END IF;
  candidate := decode(p_candidate_hash, 'hex');
  SELECT code.code_hash, code.expires_at, code.attempts, code.locked_at, code.consumed_at
  INTO code_record
  FROM public.delivery_codes code
  WHERE code.delivery_job_id = p_delivery_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unavailable'::text, 0, false;
    RETURN;
  END IF;
  IF code_record.consumed_at IS NOT NULL OR code_record.locked_at IS NOT NULL
     OR code_record.expires_at <= clock_timestamp() OR code_record.attempts >= 5 THEN
    RETURN QUERY SELECT 'unavailable'::text, greatest(5 - code_record.attempts, 0),
      (code_record.locked_at IS NOT NULL OR code_record.attempts >= 5);
    RETURN;
  END IF;
  IF public.app_constant_time_equals(decode(code_record.code_hash, 'hex'), candidate) THEN
    UPDATE public.delivery_codes SET consumed_at = clock_timestamp()
    WHERE delivery_job_id = p_delivery_job_id AND consumed_at IS NULL AND locked_at IS NULL;
    RETURN QUERY SELECT 'verified'::text, 5 - code_record.attempts, false;
    RETURN;
  END IF;
  next_attempts := code_record.attempts + 1;
  is_locked := next_attempts >= 5;
  UPDATE public.delivery_codes
  SET attempts = next_attempts,
      locked_at = CASE WHEN is_locked THEN clock_timestamp() ELSE locked_at END
  WHERE delivery_job_id = p_delivery_job_id;
  RETURN QUERY SELECT 'invalid'::text, greatest(5 - next_attempts, 0), is_locked;
END;
$$;
