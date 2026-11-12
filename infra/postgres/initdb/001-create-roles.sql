\set ON_ERROR_STOP on
\getenv app_db_password APP_DB_PASSWORD
\getenv auth_db_password AUTH_DB_PASSWORD
\getenv worker_db_password WORKER_DB_PASSWORD
\getenv database_name POSTGRES_DB

SELECT format('CREATE ROLE annapurna_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD %L', :'app_db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'annapurna_app')\gexec
SELECT format('CREATE ROLE annapurna_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD %L', :'auth_db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'annapurna_auth')\gexec
SELECT format('CREATE ROLE annapurna_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD %L', :'worker_db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'annapurna_worker')\gexec

ALTER ROLE annapurna_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE annapurna_auth NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE annapurna_worker NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE :"database_name" TO annapurna_app, annapurna_auth, annapurna_worker;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO annapurna_app, annapurna_auth, annapurna_worker;
CREATE SCHEMA IF NOT EXISTS graphile_worker AUTHORIZATION annapurna_worker;
ALTER SCHEMA graphile_worker OWNER TO annapurna_worker;
GRANT USAGE, CREATE ON SCHEMA graphile_worker TO annapurna_worker;
