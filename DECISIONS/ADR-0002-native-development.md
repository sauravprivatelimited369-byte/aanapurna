# ADR 0002: Native local development without Docker

Date: 2026-11-13. Status: implemented for isolated development, not production.

Docker Compose is useful for reproducible deployment but is not available on every developer machine. The app requires PostgreSQL and its database roles, RLS, worker and SMTP adapter; replacing them with browser state, a JSON file or an embedded PostgreSQL emulator would not validate that stack. Keep Compose and add a native Node.js runner using an independently installed local PostgreSQL server, existing migrations and restricted roles. A loopback-only explicitly labelled local test SMTP sink stores test emails in a Git-ignored private file; this is not a production mail provider or replacement for Mailpit. PostgreSQL must be separately installed and running.

Bootstrap requires an explicit local administrator connection and refuses to overwrite any existing Annapurna role or database. The local migrator is a superuser, as in the existing local Compose setup, while app/auth/worker roles are restricted. The setup is for a disposable isolated development instance only. The local runner refuses remote databases and enabled real operations. Production remains outside the scope of this fallback.

For the sandbox verification only, a disposable PostgreSQL 18 instance was launched using `leinelissen/embedded-postgres` binaries installed outside this repository. Its npm package reports MIT licensing and its GitHub repository was active and unarchived when checked on 2026-11-13. It is a beta package and is **not** a project dependency or the recommended production database. Real PostgreSQL was used to run the native setup, all eight migrations, and the role check; no Docker image or Compose runtime was verified. See BUILD_STATUS for current test results and remaining gaps.


## 2026-11-13 addition: managed Windows first launch

A fresh Windows x64 `start.bat` now downloads the pinned MIT-licensed `embedded-postgres` 17.11.0-beta.19 package as a development dependency and starts a persistent, real PostgreSQL instance on loopback port 55432, with generated local-only secrets and migrations. The npm-distributed binaries are a beta local-development convenience, not a recommendation for a production database. Existing `.env` configurations are preserved and continue to require their own running/migrated PostgreSQL. The launcher refuses missing credentials, incomplete state, occupied ports and enabled operations rather than overwrite data. The owner must protect and back up the ignored local files; Windows ACLs, backups and safe upgrade/restore remain operator responsibilities. Local SMTP remains a private test sink, not Gmail or another live provider.
