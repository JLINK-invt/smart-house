#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s BACKUP_FILE [TARGET_DATABASE] [--replace]\n' "$(basename "$0")" >&2
  printf 'Without TARGET_DATABASE, restores safely into smart_house_restore.\n' >&2
  printf 'Set CONFIRM_RESTORE=smart_house when replacing the primary local database.\n' >&2
  exit 2
}

[[ "${1:-}" != "--" ]] || shift
[[ $# -ge 1 && $# -le 3 ]] || usage
backup_file="$1"
target_database="${2:-smart_house_restore}"
replace="${3:-}"
[[ "$replace" == "" || "$replace" == "--replace" ]] || usage
[[ -f "$backup_file" ]] || { printf 'Backup file not found: %s\n' "$backup_file" >&2; exit 1; }
[[ "$target_database" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
  printf 'Target database must be a PostgreSQL identifier: %s\n' "$target_database" >&2
  exit 1
}

if [[ "$target_database" == "smart_house" && "$replace" != "--replace" ]]; then
  printf 'Refusing to restore into smart_house without --replace.\n' >&2
  exit 1
fi
if [[ "$target_database" == "smart_house" && "${CONFIRM_RESTORE:-}" != "smart_house" ]]; then
  printf 'Set CONFIRM_RESTORE=smart_house to replace the primary local database.\n' >&2
  exit 1
fi

root_dir="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
compose_file="$root_dir/infra/local/docker-compose.yml"
db_user="${POSTGRES_USER:-smart_house}"

if [[ -f "$backup_file.sha256" ]]; then
  (cd "$(dirname "$backup_file")" && sha256sum --check "$(basename "$backup_file").sha256")
fi

database_exists() {
  docker compose -f "$compose_file" exec -T postgres psql -X -U "$db_user" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$target_database'" | grep -qx 1
}

if database_exists; then
  [[ "$replace" == "--replace" ]] || {
    printf 'Target database exists. Re-run with --replace to discard it: %s\n' "$target_database" >&2
    exit 1
  }
  docker compose -f "$compose_file" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U "$db_user" -d postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$target_database' AND pid <> pg_backend_pid();" \
    -c "DROP DATABASE \"$target_database\";"
fi

docker compose -f "$compose_file" exec -T postgres createdb -U "$db_user" "$target_database"
docker compose -f "$compose_file" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U "$db_user" -d "$target_database" \
  -c 'CREATE EXTENSION IF NOT EXISTS timescaledb;' \
  -c 'SELECT timescaledb_pre_restore();'
if ! docker compose -f "$compose_file" exec -T postgres pg_restore -U "$db_user" -d "$target_database" \
  --exit-on-error --no-owner --no-privileges < "$backup_file"; then
  docker compose -f "$compose_file" exec -T postgres psql -X -U "$db_user" -d "$target_database" \
    -c 'SELECT timescaledb_post_restore();' >/dev/null || true
  exit 1
fi
docker compose -f "$compose_file" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U "$db_user" -d "$target_database" \
  -c 'SELECT timescaledb_post_restore();'
docker compose -f "$compose_file" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U "$db_user" -d "$target_database" \
  -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';" \
  -c 'SELECT version, applied_at FROM schema_migrations ORDER BY version;' \
  -c 'SELECT count(*) AS telemetry_records FROM telemetry_records;'

printf 'Restore completed and verified: %s\n' "$target_database"
