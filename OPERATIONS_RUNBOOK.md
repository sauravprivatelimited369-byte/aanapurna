# Operations runbook

Routine operation of the running system. Written for whoever is on duty, not for the person who wrote
the code.

## Daily

1. `GET /api/health` — expect `status: ok`, `database.status: ok`, `email.status` not
   `not_configured`, and `worker.status: ok` with an `ageSeconds` under 180.
2. Operations console — partner requests awaiting review, open incidents, recalls.
3. Support queue — anything with a delivery date today goes first.
4. Deliveries in progress — any job open past its pickup window needs a phone call, not an alert.

## Reading `/api/health`

| Field | Meaning | Action |
|---|---|---|
| `database.status: unavailable` | The app cannot reach PostgreSQL | Everything else is a symptom; check the database first |
| `email.status: not_configured` | No SMTP settings; nothing is queued as sent | Users will not receive verification or reset mail |
| `email.status: test_sink` | A capture transport accepted the message; **no real inbox receives it** | Do not promise a user that mail is on its way |
| `worker.status: never_seen` | No worker has ever written a heartbeat in this environment | Expected on a web-only host; a delivery blocker on a full deployment |
| `worker.status: stale` | Last heartbeat is over 180 seconds old | The worker has stopped. Notifications are queuing. Restart it |
| `realOperationsEnabled: false` | The launch gate is closed | Donation actions return `423`; this is a decision, not a fault |

## The worker

- Runs as its own process: `npm run worker` (Compose service `worker`).
- Cron `drain-email-outbox` every minute; heartbeat every 30 seconds; graceful stop on SIGTERM.
- If it dies, the queue keeps growing and nothing is lost — but nothing is delivered either.
- Check the outbox directly when in doubt:
  `select status, count(*) from public.email_outbox group by status order by status;`
- Failed messages keep a bounded attempt count and an error message; both are visible in the admin
  overview counters.

## Notifications that did not arrive

1. Confirm `email.status` and the worker heartbeat.
2. Look at the outbox row: `pending` means the drainer has not run; `failed` means the provider
   rejected it.
3. Re-delivery is safe: the drain is bounded and idempotent per row.
4. Tell the affected person through a channel that works today — phone — rather than waiting.

## Password or access rescue

Email-based reset only works when real SMTP is configured. Until then:

1. Confirm the identity out of band (known phone, known colleague).
2. A security administrator or operations administrator restores access server-side.
3. Record the reason. The audit trail must show a human made this decision.

Never read a password, never set one silently, never send one in a chat message.

## Queue of partner reviews

Oldest first. A request older than two working days is answered, even if the answer is "we need a
document". Silence is the worst outcome for a partner who is offering food.

## Backups

- Database: nightly `pg_dump` per `DEPLOYMENT`/`HOSTED_DEPLOYMENT`; keep encrypted copies off the
  host. `scripts/test-local-backup.mjs` performs a disposable restore drill.
- Private uploads: the `PRIVATE_STORAGE_DIR` volume, which must be a persistent volume in any real
  deployment (the Vercel preview uses an ephemeral directory and therefore loses documents).
- A backup that has never been restored is a hope. Run the drill monthly and record the date.

## Scheduled jobs to watch

| Job | Cadence | Failure symptom |
|---|---|---|
| Expire donations | worker | Listings stay `offered` past their window; acceptance still refuses them |
| Notification drain | every minute | Outbox pile-up; `worker` heartbeat stale |
| Heartbeat | every 30 seconds | `worker.status: stale` |

## Monthly

- Restore drill, recorded.
- Review suspended and pending organisations; nothing should sit indefinitely.
- Review privileged accounts; remove roles nobody is using.
- Check dependency advisories (`npm audit`) and apply patch upgrades.
