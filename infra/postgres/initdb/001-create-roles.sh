#!/bin/sh
set -eu
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
: "${AUTH_DB_PASSWORD:?AUTH_DB_PASSWORD is required}"
: "${WORKER_DB_PASSWORD:?WORKER_DB_PASSWORD is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --file=/docker-entrypoint-initdb.d/001-create-roles.sql
