#!/usr/bin/env bash
set -euo pipefail

root_dir="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
compose_file="$root_dir/infra/local/docker-compose.yml"
backup_dir="${BACKUP_DIR:-$root_dir/backups}"
database="${POSTGRES_DB:-smart_house}"
db_user="${POSTGRES_USER:-smart_house}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$backup_dir"
backup_file="$backup_dir/${database}-${timestamp}.dump"

docker compose -f "$compose_file" exec -T postgres pg_isready -U "$db_user" -d "$database" >/dev/null
docker compose -f "$compose_file" exec -T postgres pg_dump \
  -U "$db_user" -d "$database" --format=custom --no-owner --no-privileges > "$backup_file"

test -s "$backup_file"
docker compose -f "$compose_file" exec -T postgres pg_restore --list < "$backup_file" >/dev/null
sha256sum "$backup_file" > "$backup_file.sha256"

printf 'Backup created: %s\nChecksum: %s.sha256\n' "$backup_file" "$backup_file"
