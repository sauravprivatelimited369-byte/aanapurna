-- Migration 19: a curated directory of the food sources around the Joka campus.
--
-- These places are public knowledge: they advertise on listing sites, they have signboards on
-- Diamond Harbour Road. What is not public knowledge is whether any of them wants to donate food,
-- who actually owns them, or which number reaches that person rather than a call centre. So the
-- table separates the three things that get conflated in a scraped directory:
--
--   * what is published (name, category, area, approximate position) — safe to show, still labelled
--     as unconfirmed;
--   * what is held privately (phone numbers, the source they came from, contact attempts) — visible
--     only to the operations roles, because phoning a business about a scheme it never heard of is
--     an approach that needs a person making it deliberately;
--   * what a human has actually confirmed with the owner (owner_verified) — false until somebody
--     speaks to them, and the public page says so.
--
-- There is deliberately no licence column. Claiming an FSSAI status from an aggregator listing is
-- exactly the kind of half-fact this project refuses to publish; the checklist lives in notes and
-- the verification is a person's word recorded with a date.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.directory_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  area text NOT NULL,
  address_line text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  -- Private by policy: never returned by the public reader below.
  phone text,
  phone_source text,
  phone_kind text NOT NULL DEFAULT 'unknown',
  source_url text,
  last_checked_on date NOT NULL DEFAULT current_date,
  consent_status text NOT NULL DEFAULT 'unknown',
  owner_verified boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  photo_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT directory_places_category_check CHECK (category IN ('banquet','hotel','restaurant','campus')),
  CONSTRAINT directory_places_phone_kind_check CHECK (phone_kind IN ('unknown','direct','business_line','marketplace_line')),
  CONSTRAINT directory_places_consent_check CHECK (consent_status IN ('unknown','contacted','consented','declined')),
  CONSTRAINT directory_places_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
COMMENT ON TABLE public.directory_places IS
  'Curated food sources near the Joka campus. Public columns are published with an unconfirmed label; phone numbers are admin-only. No licence status is stored or implied.';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS directory_places_category_idx ON public.directory_places (category, name);
--> statement-breakpoint

ALTER TABLE public.directory_places ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.directory_places FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS directory_places_read ON public.directory_places;
--> statement-breakpoint
CREATE POLICY directory_places_read ON public.directory_places FOR SELECT
USING (public.app_has_platform_role(ARRAY['operations_admin','security_admin','safety_officer','support_agent']));
--> statement-breakpoint
DROP POLICY IF EXISTS directory_places_write ON public.directory_places;
--> statement-breakpoint
CREATE POLICY directory_places_write ON public.directory_places FOR UPDATE
USING (public.app_has_platform_role(ARRAY['operations_admin','security_admin']))
WITH CHECK (public.app_is_domain_transition() AND public.app_has_platform_role(ARRAY['operations_admin','security_admin']));
--> statement-breakpoint
REVOKE ALL ON TABLE public.directory_places FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, UPDATE ON TABLE public.directory_places TO annapurna_app;
--> statement-breakpoint

-- The public projection. Phone numbers, notes and consent state stay out of it; the verification
-- label is a boolean a human set, not a licence claim. A photo appears only when an operator has
-- entered one that the owner gave them — listing sites' photos are copyrighted and are not copied.
CREATE OR REPLACE FUNCTION public.app_public_directory() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'slug', place.slug,
    'name', place.name,
    'category', place.category,
    'area', place.area,
    'addressLine', place.address_line,
    'latitude', place.latitude,
    'longitude', place.longitude,
    'ownerVerified', place.owner_verified,
    'photoUrl', place.photo_url,
    'lastCheckedOn', place.last_checked_on
  ) ORDER BY place.category, place.name), '[]'::jsonb)
  FROM public.directory_places place
  WHERE place.published = true
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_public_directory() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_public_directory() TO annapurna_app;
--> statement-breakpoint

-- Research notes for the first pass. Names, areas and addresses are published because they are
-- already public facts on a signboard. Numbers are not published anywhere, owner confirmation is
-- false on every row, and the page labels each one accordingly.
INSERT INTO public.directory_places
  (slug, name, category, area, address_line, latitude, longitude, phone, phone_source, phone_kind, published, notes)
VALUES
  ('halla-bowl', 'Halla Bowl', 'restaurant', 'Diamond Harbour Road, Joka', '680, Diamond Harbour Road, near IIM, Joka, Kolkata 700104', NULL, NULL, '+919007087129', 'Zomato listing, 2026-11-15', 'business_line', true,
   'Bengali, North Indian, Chinese. Already the single record shown on /near-iim-calcutta from the public read API. Number is the one printed on the listing; confirm it reaches the owner.'),
  ('at-coffee-cafe', 'At Coffee Cafe', 'restaurant', 'Diamond Harbour Road, Joka', '680, Diamond Harbour Road, near IIM, Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Multicuisine cafe in the same complex as Halla Bowl and Aristro Club. No number published outside the listing app.'),
  ('dakshinayan-joka', 'Dakshinayan Restaurant', 'restaurant', 'Diamond Harbour Road, Joka', 'Near Diamond Park and the Thakurpukur 3A bus stand, Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'South Indian. No published number found.'),
  ('handi-food-court', 'Handi Food Court', 'restaurant', 'Joka, Kolkata 700104', 'Joka B 5/2, Diamond Park, Joka, Kolkata 700104', NULL, NULL, '+919831318869', 'Justdial listing, 2026-11-15', 'business_line', true,
   'Chinese, Mughlai, seafood, North Indian. Mid-size food court; the most plausible restaurant-scale surplus in the immediate cluster.'),
  ('oh-kitchen', 'Oh! Kitchen', 'restaurant', 'Diamond Harbour Road, Joka', '36, Borough 16, Diamond Harbour Road, Joka, Kolkata 700104', NULL, NULL, '+917003977380', 'Zomato listing, 2026-11-15', 'business_line', true,
   'Small, low price point, street food and North Indian.'),
  ('eatli-joka', 'Eatli', 'restaurant', 'Diamond Harbour Road, Joka', '168, Diamond Harbour Road, Joka, Kolkata 700104', 22.454636, 88.303648, '+916289976524', 'Zomato and District listings, 2026-11-15', 'business_line', true,
   'South Indian, quick service. Coordinates are the listing coordinates, not a survey.'),
  ('joka-restaurant-cum-bar', 'Joka Restaurant cum Bar', 'restaurant', 'Diamond Harbour Road, Joka Industrial Plaza', '43/5/1, Diamond Harbour Road, beside the Hyundai showroom, Joka, Kolkata 700104', 22.448827, 88.301973, NULL, NULL, 'unknown', true,
   'Bar and restaurant. Coordinates from the listing.'),
  ('kitchen-of-flavours', 'Kitchen Of Flavours', 'restaurant', 'Joka', 'Near 22 Bigha Road, Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Chinese, North Indian, Bengali, seafood.'),
  ('new-hungryy-birdz', 'New Hungryy Birdz', 'restaurant', 'Joka', 'Srijoni Road, Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Chinese, South Indian, seafood. Opposite the Thakurpukur cancer hospital area.'),
  ('buddha-bites', 'Buddha Bites', 'restaurant', 'James Long Sarani, Joka', 'James Long Sarani, Diamond Park, Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Fast food, late opening.'),
  ('food-and-foodies', 'Food & Foodies', 'restaurant', 'James Long Sarani, Joka', '60/1, James Long Sarani, Diamond Park, Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Multi-cuisine.'),
  ('machan-iimc', 'Machan (IIMC coffee shop)', 'campus', 'IIM Calcutta campus', 'Inside the IIM Calcutta campus, Diamond Harbour Road, Joka 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'On-campus cafe. Any arrangement needs the institute''s own approval, not a shop manager''s.'),

  ('aristro-club', 'Aristro Club', 'hotel', 'Diamond Harbour Road, Joka (opposite IIM)', '680, Diamond Harbour Road, opposite the IIM management block, Joka, Kolkata 700104', NULL, NULL, '+918048124277', 'Weddingz venue listing, 2026-11-15', 'marketplace_line', true,
   'Rooms, pool, restaurant and banquet, directly across the road from the campus. The published number is a venue-marketplace line, not necessarily the club''s own.'),
  ('super-collection-o-joka-industrial-plaza', 'Super Collection O Joka Industrial Plaza', 'hotel', 'Joka Industrial Plaza, Diamond Harbour Road', 'Plot 43/2, Diamond Harbour Road, Joka Industrial Plaza, Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Budget hotel near Joka metro. Chain call-centre numbers are deliberately not stored.'),
  ('super-collection-o-behala', 'Super Collection O Behala (Urban Guest House)', 'hotel', 'Diamond Harbour Road, Joka', '43/3, Diamond Harbour Road, Joka Industrial Plaza, Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Listing states 1.1 km drive to IIM Calcutta.'),
  ('townhouse-joka-industrial-plaza', 'Townhouse Joka Industrial Plaza', 'hotel', 'Vivekananda Pally, Joka', 'Diamond Harbour Road, Vivekananda Pally, Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Budget hotel, listed a short walk from Joka metro.'),
  ('eagle-inn-joka', 'Eagle Inn', 'hotel', 'Diamond Harbour Road, Joka', 'Diamond Harbour Road, Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Small hotel; details unconfirmed.'),
  ('hotel-buildtech-inn', 'Hotel Buildtech Inn', 'hotel', 'Thakurpukur', 'Diamond Harbour Road, near the 3A bus stop and cancer hospital, Thakurpukur, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Three-star with parking and a kitchen.'),
  ('hotel-parkstone', 'Hotel Parkstone', 'hotel', 'Thakurpukur', '150A Diamond Harbour Road, Thakurpukur, Kolkata 700063', NULL, NULL, NULL, NULL, 'unknown', true,
   'Restaurant on site; about 5 km from the campus gate.'),
  ('jameson-inn-shiraz', 'Jameson Inn Shiraz', 'hotel', 'Joka', 'Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Three-star hotel; address unconfirmed beyond the locality.'),
  ('oyo-premium-joka-iim', 'OYO Premium Joka IIM', 'hotel', 'Diamond Harbour Road, Bratachari Gram', '680, Diamond Harbour Road, Bratachari Gram, Joka, Kolkata 700104', NULL, NULL, '+919313931393', 'Trivago listing, 2026-11-15', 'marketplace_line', true,
   'Listed explicitly as near IIM. Number is the booking line printed on the aggregator page.'),
  ('iimc-mdc', 'IIM Calcutta MDC', 'campus', 'Inside IIM Calcutta campus', 'Management Development Centre, IIM Calcutta, Diamond Harbour Road, Joka 700104', NULL, NULL, '+913324380500', 'Institute contact page via public listing, 2026-11-15', 'business_line', true,
   'Institute-run executive accommodation with dining, about a kilometre inside the gate. Any donation arrangement is an institutional decision.'),
  ('iimc-tata-hall', 'Tata Hall (IIMC guest house)', 'campus', 'Inside IIM Calcutta campus', 'IIM Calcutta campus, Joka, Kolkata 700104', NULL, NULL, NULL, NULL, 'unknown', true,
   'Campus guest house for visitors and guest faculty.'),

  ('shree-shyam-banquet', 'Shree Shyam Banquet', 'banquet', 'Diamond Harbour Road, Joka / Pailan', 'Diamond Harbour Road, Pailan, Bishnupur, South 24 Parganas 743503', NULL, NULL, '+919606226851', 'Justdial listing, 2026-11-15', 'business_line', true,
   'Hall and lawn, listed up to about 600 guests, in-house catering. The strongest single-window surplus lead in the area.'),
  ('navnir-farms-and-banquets', 'Navnir Farms & Banquets', 'banquet', 'Bakhrahat Road, Joka', 'Bakhrahat Road, Joka, Kolkata 700104', NULL, NULL, '+919036215967', 'Justdial listing, 2026-11-15', 'business_line', true,
   'Large farm venue, listed as a 500+ guest option.'),
  ('royal-crown-banquet', 'Royal Crown Banquet', 'banquet', 'Mahatma Gandhi Road, Joka', 'Near Kabardanga auto stand, Mahatma Gandhi Road, Joka, Kolkata 700104', NULL, NULL, '+918128081358', 'Justdial listing, 2026-11-15', 'business_line', true,
   'Banquet hall and guest house.'),
  ('balika-bodhu-banquet', 'Balika Bodhu Banquet', 'banquet', 'Mahatma Gandhi Road, Joka', 'Mahatma Gandhi Road, Joka, Kolkata 700104', NULL, NULL, '+918460393911', 'Justdial listing, 2026-11-15', 'business_line', true,
   'AC banquet hall.'),
  ('s-k-garden', 'S K Garden', 'banquet', 'Nimtala More, Thakurpukur', 'Nimtala More, Thakurpukur, Kolkata 700063', NULL, NULL, '+919054299157', 'Justdial listing, 2026-11-15', 'business_line', true,
   'Large garden venue with parking.'),
  ('hotel-east-palace', 'Hotel East Palace', 'banquet', 'Konchowki, Diamond Harbour Road', 'Konchowki, P.O. Bishnupur, Diamond Harbour Road, Kolkata 743503', 22.419272, NULL, '+919230613727', 'Weddingz and venue pages, 2026-11-15', 'business_line', true,
   'Three halls, listed 60–200 guests, in-house and outside catering allowed. Latitude from the venue page; longitude unconfirmed.'),
  ('the-creek-club', 'The Creek Club', 'banquet', 'Pailan Park, Amgachia Road', 'Pailan Park Housing Project, Amgachia Road, off Diamond Harbour Road, Pailan, Kolkata 700104', NULL, NULL, '+918048126314', 'Weddingz venue listing, 2026-11-15', 'marketplace_line', true,
   '200–1500 guest venue. Published number is a venue-marketplace line.'),
  ('ibiza-the-fern', 'Ibiza The Fern Resort and Spa', 'banquet', 'Kriparampur, Diamond Harbour Road', 'Merlin Greens, Kriparampur, Diamond Harbour Road, Kolkata 743503', NULL, NULL, '+911140137453', 'Weddingz venue listing, 2026-11-15', 'marketplace_line', true,
   'Resort with banquet halls and lawns, roughly 10–12 km south of the gate. Published number is a venue-marketplace line.')
ON CONFLICT (slug) DO NOTHING;
