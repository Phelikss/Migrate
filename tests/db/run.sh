#!/usr/bin/env bash
# Runs the migration + RLS tests against a THROWAWAY local Postgres (never a real project).
# Usage: PGHOST=<socket dir or host> PGPORT=<port> PGUSER=<user> tests/db/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=migrate_rls_test
psql -qAt -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
$P -f 00_supabase_stub.sql
$P -f 01_baseline_schema.sql
$P -f ../../supabase/migrations/20261027000000_migrate_overhaul.sql
echo "--- migration applied; running it a second time to prove it is idempotent"
$P -f ../../supabase/migrations/20261027000000_migrate_overhaul.sql
psql -v ON_ERROR_STOP=1 -d $DB -f 02_rls_tests.sql
