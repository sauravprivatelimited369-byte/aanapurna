-- Migration 16: transit limits, receiver self-collection, and forced row-level security.
--
-- G3 in the gap register said the application could compare service areas but had no idea how far
-- anything was, and that a receiver had no way to collect its own food. Both change here.
--
-- Distance has to come from somewhere. Nothing in the product collects coordinates today, and
-- requiring them before anything works would make the feature inert. So there are two sources:
--   1. optional exact coordinates on an organisation (`latitude`/`longitude`);
--   2. a small checked-in gazetteer of Indian places, matched against the free-text city field the
--      onboarding form already captures.
-- If neither yields a pair of points, the delivery stays "distance unknown" - the application never
-- invents a number it cannot support.

--> statement-breakpoint
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9,6);
--> statement-breakpoint
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT organizations_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  -- Half a coordinate is worse than none: it silently places an organisation on the equator.
  ADD CONSTRAINT organizations_coordinates_paired CHECK ((latitude IS NULL) = (longitude IS NULL));
--> statement-breakpoint
ALTER TABLE public.service_areas
  ADD COLUMN IF NOT EXISTS max_transit_km numeric(6,2),
  ADD COLUMN IF NOT EXISTS average_speed_kmph numeric(5,1) NOT NULL DEFAULT 20;
--> statement-breakpoint
ALTER TABLE public.service_areas
  ADD CONSTRAINT service_areas_max_transit_range CHECK (max_transit_km IS NULL OR max_transit_km BETWEEN 0.5 AND 200),
  ADD CONSTRAINT service_areas_speed_range CHECK (average_speed_kmph BETWEEN 5 AND 80);
--> statement-breakpoint

-- The gazetteer. Read-only reference data: no personal data, no writes from the application.
CREATE TABLE IF NOT EXISTS public.geo_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  latitude numeric(9,6) NOT NULL,
  longitude numeric(9,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_places_latitude_range CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT geo_places_longitude_range CHECK (longitude BETWEEN -180 AND 180)
);
--> statement-breakpoint
INSERT INTO public.geo_places (name, normalized_name, latitude, longitude) VALUES
  ('Bhubaneswar', 'bhubaneswar', 20.296059, 85.824539),
  ('Cuttack', 'cuttack', 20.462521, 85.882988),
  ('Khordha', 'khordha', 20.182576, 85.616520),
  ('Khurda', 'khurda', 20.182576, 85.616520),
  ('Puri', 'puri', 19.813455, 85.831238),
  ('Konark', 'konark', 19.887600, 86.094500),
  ('Nayagarh', 'nayagarh', 20.128800, 85.096400),
  ('Ganjam', 'ganjam', 19.384000, 84.916000),
  ('Berhampur', 'berhampur', 19.314900, 84.794100),
  ('Gopalpur', 'gopalpur', 19.268900, 84.905600),
  ('Jagatsinghpur', 'jagatsinghpur', 20.254100, 86.171500),
  ('Paradip', 'paradip', 20.316500, 86.611700),
  ('Kendrapara', 'kendrapara', 20.501800, 86.422500),
  ('Jajpur', 'jajpur', 20.849100, 86.338000),
  ('Bhadrak', 'bhadrak', 21.057400, 86.515400),
  ('Balasore', 'balasore', 21.493400, 86.933500),
  ('Dhenkanal', 'dhenkanal', 20.840000, 85.597000),
  ('Angul', 'angul', 20.840700, 85.101800),
  ('Sambalpur', 'sambalpur', 21.466900, 83.981200),
  ('Rourkela', 'rourkela', 22.260400, 84.853600),
  ('Sundargarh', 'sundargarh', 22.116700, 84.033300),
  ('Keonjhar', 'keonjhar', 21.628900, 85.581700),
  ('Mayurbhanj', 'mayurbhanj', 21.933300, 86.733300),
  ('Baripada', 'baripada', 21.933300, 86.733300),
  ('Kolkata', 'kolkata', 22.572645, 88.363892),
  ('Chennai', 'chennai', 13.082680, 80.270721),
  ('Bengaluru', 'bengaluru', 12.971599, 77.594566),
  ('Bangalore', 'bangalore', 12.971599, 77.594566),
  ('Hyderabad', 'hyderabad', 17.385044, 78.486671),
  ('Mumbai', 'mumbai', 19.076090, 72.877426),
  ('Delhi', 'delhi', 28.704060, 77.102493),
  ('New Delhi', 'newdelhi', 28.613939, 77.209023),
  ('Pune', 'pune', 18.520430, 73.856743),
  ('Ahmedabad', 'ahmedabad', 23.022505, 72.571365),
  ('Jaipur', 'jaipur', 26.912434, 75.787270),
  ('Lucknow', 'lucknow', 26.846695, 80.946167),
  ('Patna', 'patna', 25.594095, 85.137566),
  ('Ranchi', 'ranchi', 23.344101, 85.309563),
  ('Guwahati', 'guwahati', 26.144517, 91.736237),
  ('Visakhapatnam', 'visakhapatnam', 17.686816, 83.218482),
  ('Vijayawada', 'vijayawada', 16.506174, 80.648015),
  ('Nagpur', 'nagpur', 21.145800, 79.088158),
  ('Raipur', 'raipur', 21.251384, 81.629641)
ON CONFLICT (normalized_name) DO NOTHING;
--> statement-breakpoint
ALTER TABLE public.geo_places ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.geo_places FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS geo_places_read ON public.geo_places;
--> statement-breakpoint
CREATE POLICY geo_places_read ON public.geo_places FOR SELECT USING (true);
--> statement-breakpoint
REVOKE ALL ON TABLE public.geo_places FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON TABLE public.geo_places TO annapurna_app;
--> statement-breakpoint

-- Delivery: how it is being made, and how far.
ALTER TABLE public.delivery_jobs
  ADD COLUMN IF NOT EXISTS collection_mode text NOT NULL DEFAULT 'helper_delivery',
  ADD COLUMN IF NOT EXISTS transit_distance_km numeric(6,2),
  ADD COLUMN IF NOT EXISTS transit_eta_minutes integer,
  ADD COLUMN IF NOT EXISTS transit_checked_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.delivery_jobs
  ADD CONSTRAINT delivery_jobs_collection_mode_check CHECK (collection_mode IN ('helper_delivery','receiver_collection')),
  ADD CONSTRAINT delivery_jobs_transit_distance_range CHECK (transit_distance_km IS NULL OR transit_distance_km BETWEEN 0 AND 5000),
  ADD CONSTRAINT delivery_jobs_transit_eta_range CHECK (transit_eta_minutes IS NULL OR transit_eta_minutes BETWEEN 0 AND 2880);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delivery_jobs_collection_mode_idx ON public.delivery_jobs (collection_mode, status);
--> statement-breakpoint

-- A receiver collecting its own food holds no Helper profile, so every policy and function that
-- asks "is this the assigned Helper?" has to recognise it. Changing the one predicate keeps the
-- rest of the model honest: the receiver is the assigned collector, and the same custody, code and
-- receipt gates apply.
CREATE OR REPLACE FUNCTION public.app_is_active_assigned_helper(p_delivery_job_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_jobs job
    LEFT JOIN public.helper_profiles helper ON helper.user_id = job.helper_user_id
    WHERE job.id = p_delivery_job_id
      AND job.helper_user_id = public.app_current_user_id()
      AND (
        helper.status::text = 'active'
        OR (
          job.collection_mode = 'receiver_collection'
          AND public.app_has_org_role(job.receiver_organization_id, ARRAY['owner','manager','operator'])
        )
      )
  )
$$;
--> statement-breakpoint

-- Transit facts are written once and collection mode cannot change once food has moved.
CREATE OR REPLACE FUNCTION public.app_guard_delivery_transit() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.collection_mode IS DISTINCT FROM OLD.collection_mode AND OLD.status::text <> 'open' THEN
    RAISE EXCEPTION 'collection mode cannot change after assignment' USING ERRCODE = '55000';
  END IF;
  IF OLD.transit_distance_km IS NOT NULL
     AND (NEW.transit_distance_km IS DISTINCT FROM OLD.transit_distance_km
       OR NEW.transit_eta_minutes IS DISTINCT FROM OLD.transit_eta_minutes) THEN
    RAISE EXCEPTION 'recorded transit estimate is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS delivery_jobs_transit_guard ON public.delivery_jobs;
--> statement-breakpoint
CREATE TRIGGER delivery_jobs_transit_guard BEFORE UPDATE ON public.delivery_jobs
FOR EACH ROW EXECUTE FUNCTION public.app_guard_delivery_transit();
--> statement-breakpoint

-- The application role may write exactly the four new delivery columns and nothing else new.
GRANT UPDATE (collection_mode, transit_distance_km, transit_eta_minutes, transit_checked_at)
  ON public.delivery_jobs TO annapurna_app;
--> statement-breakpoint

-- G4c: policies used to apply only because no application role owned a table. FORCE closes that:
-- from now on the owner is subject to its own policies too. The owner (`postgres`) holds
-- BYPASSRLS on the hosted project, so migrations, SECURITY DEFINER functions and maintenance keep
-- working, while a future accidental ownership change cannot quietly bypass a policy.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target.relname);
  END LOOP;
END;
$$;
--> statement-breakpoint
COMMENT ON COLUMN public.delivery_jobs.collection_mode IS
  'helper_delivery: an approved Helper collects and delivers. receiver_collection: the receiving organisation collects its own food; the receiving user holds the assignment.';
