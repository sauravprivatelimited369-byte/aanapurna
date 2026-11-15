-- Migration 27: device notifications on a deployment that has no long-lived worker.
--
-- Migration 26 added the table and four functions, and all of it was correct in isolation. Three things
-- were wrong about how it met the hosted deployment, and each was invisible until a real person tried:
--
-- 1. Nothing claimed a notification before sending it. The sender read "what has not been pushed" and
--    marked it afterwards, which is safe only while exactly one process ever sends. The hosted site has
--    no worker at all, so sending has to happen from short-lived requests - several at once - and two of
--    them reading the same unmarked row means two notifications on one phone.
--
-- 2. A send that failed for a passing reason was recorded as delivered. The row was marked whatever the
--    push service answered, so a 503 lost the notification for good.
--
-- 3. `app_push_targets` and `app_revoke_push_subscription` were granted to the web role and treated "no
--    session user" as "this is the worker". The web role with no session set is not the worker; it is a
--    request handler that forgot to set one - the exact mistake that kept every registration from being
--    stored. Forced row-level security turns that mistake into "sees nothing". These two functions
--    turned it into "may read anybody's endpoint and keys".
--
-- This migration is applied by the build before the new code is serving, so it is written against the
-- release that is live while it runs. Nothing that worked in that release stops working: columns are
-- only added, every function it calls keeps its name and signature, and the worker role keeps every
-- grant it had. Two things it can observe do change, and both were already dead ends. Its registration
-- statement - which the database refused on every call - now fails on the replaced index instead; and
-- its web role loses two grants it could only have used from a request that had set no session.

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS push_attempts integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Doubles as the claim. A sender that takes a row moves this into the near future; if that sender dies
-- the row becomes available again by itself, with no lock to clean up and no second table.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS push_next_attempt_at timestamptz;
--> statement-breakpoint
-- `push_delivered_at` only ever meant "finished with". This says how: a push service accepted it for at
-- least one device, or there was no device to send to. Null with attempts above zero reads as "tried,
-- nothing accepted it" - which is the answer somebody needs when a notification is said not to have
-- arrived.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS push_outcome text;
--> statement-breakpoint
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_push_outcome_known;
--> statement-breakpoint
ALTER TABLE public.notifications ADD CONSTRAINT notifications_push_outcome_known
  CHECK (push_outcome IS NULL OR push_outcome IN ('delivered', 'no_device'));
--> statement-breakpoint
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz;
--> statement-breakpoint

-- One live registration per endpoint, any number of retired ones.
--
-- The original index made an endpoint unique for ever, so a retired row had to be brought back to life
-- to register the same browser again - erasing the record that it had been retired, and why. It also
-- made a shared phone unusable: the second person to sign in on it collided with the first person's row,
-- which row-level security would not let them see, and the insert failed.
DROP INDEX IF EXISTS public.push_subscriptions_endpoint_key;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_live_endpoint_key
  ON public.push_subscriptions (endpoint) WHERE revoked_at IS NULL;
--> statement-breakpoint

-- Register the browser the caller is holding.
--
-- SECURITY DEFINER because one case needs to touch a row the caller cannot see: a browser that another
-- account registered and that the caller is now signed in on. Proof that it is the same browser is the
-- subscription's own key material, which only that browser profile holds - an endpoint alone is not
-- enough to retire somebody else's device. The owner is always the session user; nothing the caller
-- sends can name another account.
CREATE OR REPLACE FUNCTION public.app_register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_device_label text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  caller text := public.app_current_user_id();
  registered uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'a signed-in user is required to register a device' USING ERRCODE = '42501';
  END IF;
  IF p_endpoint IS NULL OR p_endpoint !~ '^https://' OR p_p256dh IS NULL OR p_auth IS NULL THEN
    RAISE EXCEPTION 'push subscription is not usable' USING ERRCODE = '22023';
  END IF;

  -- Two registrations of one endpoint are serialised here rather than by catching a unique violation.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_endpoint, 0));

  UPDATE public.push_subscriptions
  SET revoked_at = clock_timestamp(),
      last_error = 'registered_by_another_account'
  WHERE endpoint = p_endpoint
    AND revoked_at IS NULL
    AND user_id <> caller
    AND p256dh = p_p256dh
    AND auth = p_auth;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  VALUES (caller, p_endpoint, p_p256dh, p_auth, left(p_device_label, 60))
  ON CONFLICT (endpoint) WHERE revoked_at IS NULL DO UPDATE
    SET p256dh = excluded.p256dh,
        auth = excluded.auth,
        device_label = excluded.device_label,
        last_seen_at = clock_timestamp(),
        last_error = NULL
    WHERE public.push_subscriptions.user_id = excluded.user_id
  RETURNING id INTO registered;

  IF registered IS NULL THEN
    -- Live for another account, and the caller did not present that browser's keys.
    RAISE EXCEPTION 'push subscription is registered to another account' USING ERRCODE = '23505';
  END IF;

  -- Delivery addresses at most ten devices per person. Without this the list a person is shown could
  -- name devices that silently receive nothing.
  UPDATE public.push_subscriptions
  SET revoked_at = clock_timestamp(),
      last_error = 'replaced_by_newer_device'
  WHERE user_id = caller
    AND revoked_at IS NULL
    AND id NOT IN (
      SELECT kept.id
      FROM public.push_subscriptions kept
      WHERE kept.user_id = caller AND kept.revoked_at IS NULL
      ORDER BY kept.last_seen_at DESC, kept.created_at DESC
      LIMIT 10
    );

  RETURN registered;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_register_push_subscription(text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_register_push_subscription(text, text, text, text) TO annapurna_app;
--> statement-breakpoint

-- Take a batch to send, so that nobody else sends it.
--
-- `FOR UPDATE SKIP LOCKED` lets two senders run at the same moment without waiting on each other and
-- without overlapping. The lease is the recovery path: a sender that is killed mid-batch - a serverless
-- function reaching its time limit is the ordinary case - simply never finishes the rows, and they come
-- back when the lease runs out.
--
-- The fifteen-minute window is unchanged from migration 26 and still deliberate: a push about food that
-- was collected an hour ago is noise. The in-app list and the email remain the record.
CREATE OR REPLACE FUNCTION public.app_claim_push_batch(p_limit integer DEFAULT 100, p_lease_seconds integer DEFAULT 60)
RETURNS TABLE(id uuid, user_id text, title text, body text, href text, attempts integer)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH candidates AS (
    SELECT notification.id
    FROM public.notifications notification
    WHERE notification.push_delivered_at IS NULL
      -- `now()`, not `clock_timestamp()`: a stable value can bound the scan of the pending index, so a
      -- claim reads the last fifteen minutes rather than every notification that ever aged out unsent.
      AND notification.created_at > now() - interval '15 minutes'
      AND (notification.push_next_attempt_at IS NULL OR notification.push_next_attempt_at <= clock_timestamp())
    ORDER BY notification.created_at
    LIMIT greatest(1, least(coalesce(p_limit, 100), 500))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.notifications notification
    SET push_attempts = notification.push_attempts + 1,
        push_next_attempt_at = clock_timestamp()
          + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 60), 600)))
    FROM candidates
    WHERE notification.id = candidates.id
    RETURNING notification.id, notification.user_id, notification.title, notification.body,
      notification.href, notification.push_attempts, notification.created_at
  )
  SELECT claimed.id, claimed.user_id, claimed.title, claimed.body, claimed.href, claimed.push_attempts
  FROM claimed
  ORDER BY claimed.created_at
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_claim_push_batch(integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_claim_push_batch(integer, integer) TO annapurna_worker;
--> statement-breakpoint

-- Every device to address for a set of people, in one round trip.
--
-- The hosted application and its database are on different continents; a lookup per person is a quarter
-- of a second each, inside a request that is about to be frozen. Worker only: this returns credentials
-- for anybody named, so it must never be reachable from a role that serves web requests.
CREATE OR REPLACE FUNCTION public.app_push_targets_for(p_user_ids text[])
RETURNS TABLE(user_id text, id uuid, endpoint text, p256dh text, auth text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT ranked.user_id, ranked.id, ranked.endpoint, ranked.p256dh, ranked.auth
  FROM (
    SELECT subscription.user_id, subscription.id, subscription.endpoint, subscription.p256dh, subscription.auth,
      row_number() OVER (
        PARTITION BY subscription.user_id
        ORDER BY subscription.last_seen_at DESC, subscription.created_at DESC
      ) AS position
    FROM public.push_subscriptions subscription
    WHERE subscription.user_id = ANY (p_user_ids)
      AND subscription.revoked_at IS NULL
  ) ranked
  WHERE ranked.position <= 10
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_push_targets_for(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_push_targets_for(text[]) TO annapurna_worker;
--> statement-breakpoint

-- Record what happened to a batch, in one round trip.
--
-- Four things can have happened to a claimed notification, kept apart because they are different
-- facts: a push service accepted the message (`p_delivered`), there was nobody to send it to
-- (`p_no_device`), nothing accepted it yet and it should be tried again (`p_retry` - the case
-- migration 26 could not express), or the sender ran out of time before it got to it (`p_released`).
-- A released notification was never tried, so it goes straight back and does not count as an attempt.
-- `p_devices` carries the per-device answers: a device the push service says is gone is retired, a
-- device that failed for a passing reason is left alone with the reason noted.
CREATE OR REPLACE FUNCTION public.app_finish_push_batch(
  p_delivered uuid[],
  p_no_device uuid[],
  p_retry uuid[],
  p_retry_seconds integer,
  p_released uuid[],
  p_devices jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF coalesce(cardinality(p_delivered), 0) > 0 THEN
    UPDATE public.notifications
    SET push_delivered_at = clock_timestamp(), push_outcome = 'delivered', push_next_attempt_at = NULL
    WHERE id = ANY (p_delivered) AND push_delivered_at IS NULL;
  END IF;

  IF coalesce(cardinality(p_no_device), 0) > 0 THEN
    UPDATE public.notifications
    SET push_delivered_at = clock_timestamp(), push_outcome = 'no_device', push_next_attempt_at = NULL
    WHERE id = ANY (p_no_device) AND push_delivered_at IS NULL;
  END IF;

  IF coalesce(cardinality(p_retry), 0) > 0 THEN
    UPDATE public.notifications
    SET push_next_attempt_at = clock_timestamp()
          + make_interval(secs => greatest(0, least(coalesce(p_retry_seconds, 30), 3600)))
    WHERE id = ANY (p_retry) AND push_delivered_at IS NULL;
  END IF;

  IF coalesce(cardinality(p_released), 0) > 0 THEN
    UPDATE public.notifications
    SET push_next_attempt_at = NULL, push_attempts = greatest(push_attempts - 1, 0)
    WHERE id = ANY (p_released) AND push_delivered_at IS NULL;
  END IF;

  IF p_devices IS NOT NULL AND jsonb_typeof(p_devices) = 'array' THEN
    UPDATE public.push_subscriptions subscription
    SET last_delivered_at = CASE WHEN answer.outcome = 'delivered' THEN clock_timestamp() ELSE subscription.last_delivered_at END,
        last_error = CASE WHEN answer.outcome = 'delivered' THEN NULL ELSE left(coalesce(answer.reason, answer.outcome), 120) END,
        revoked_at = CASE WHEN answer.outcome = 'gone' THEN clock_timestamp() ELSE subscription.revoked_at END
    FROM jsonb_to_recordset(p_devices) AS answer(id uuid, outcome text, reason text)
    WHERE subscription.id = answer.id
      AND subscription.revoked_at IS NULL
      AND answer.outcome IN ('delivered', 'gone', 'failed');
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_finish_push_batch(uuid[], uuid[], uuid[], integer, uuid[], jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_finish_push_batch(uuid[], uuid[], uuid[], integer, uuid[], jsonb) TO annapurna_worker;
--> statement-breakpoint

-- The two grants that let a web request with no session read or retire anybody's device.
--
-- A person's own devices are read and retired through the table, where row-level security scopes every
-- statement to the session user and an unset session sees nothing. Sending is done with the worker
-- role, from the worker or from the web tier's own worker connection, never as the web role.
--
-- The functions themselves stay, along with `app_unpushed_notifications` and `app_mark_push_delivered`:
-- a build of an earlier release checks that they exist, and removing them would fail that build for no
-- gain. Nothing in this release calls them.
REVOKE EXECUTE ON FUNCTION public.app_push_targets(text) FROM annapurna_app;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.app_revoke_push_subscription(uuid, text) FROM annapurna_app;
