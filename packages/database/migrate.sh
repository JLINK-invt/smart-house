#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 -U smart_house -d smart_house <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

for file in /migrations/*.sql; do
  version=${file##*/}
  version=${version%.sql}
  applied=$(psql -X -U smart_house -d smart_house -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version'")
  if [ "$applied" != "1" ]; then
    psql -v ON_ERROR_STOP=1 -U smart_house -d smart_house -f "$file"
  fi
done
