#!/bin/bash
# Author: Brijesh Dave <https://github.com/brijeshdave>
# Postgres init hook (dev): create the separate log database alongside the app
# database provisioned by the official image via POSTGRES_DB.
set -euo pipefail

log_db="${POSTGRES_LOG_DB:-reportly_logs}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
	SELECT 'CREATE DATABASE ${log_db}'
	WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${log_db}')\gexec
EOSQL

echo "Ensured log database '${log_db}' exists."
