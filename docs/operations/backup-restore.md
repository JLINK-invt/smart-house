# Backup and restore

The current store is PostgreSQL 17 with TimescaleDB in Docker. The target is an
RPO below 15 minutes and RTO below one hour (`slo-baseline.md`). The local
procedure below produces a portable custom-format logical dump, validates its
table of contents, checks a SHA-256 digest, and restores it into an isolated
database first. It does not back up Docker volumes, Redis, Mosquitto session
state, certificates, or IdP state; production needs separately scheduled,
encrypted, access-controlled backups for each persistent service.

## Create a backup

Start the local database and run:

```bash
pnpm infra:up
pnpm ops:backup
```

The script writes `backups/smart_house-<UTC timestamp>.dump` and a matching
`.sha256` file. `BACKUP_DIR=/secure/path pnpm ops:backup` selects another local
destination. Keep backup media outside the repository and restrict it because
the dump contains tenant data and may contain credential references.

For a production-equivalent deployment, schedule this command or the equivalent
`pg_dump --format=custom` at least every 15 minutes, encrypt it at rest, retain
off-host copies, test restore access, and record the backup timestamp and
checksum. The repository does not provide a cloud backup target or key manager.

## Test a restore

Restore every scheduled backup into a disposable database before relying on it:

```bash
pnpm ops:restore -- backups/smart_house-<UTC timestamp>.dump smart_house_restore --replace
```

The helper verifies the checksum when present, creates the target database,
uses TimescaleDB's required pre/post restore mode, restores the dump, and checks
the Timescale extension, migration ledger, and telemetry row count. It never
replaces `smart_house` unless explicitly asked.
Run application-level verification against the restored database in an isolated
environment, including tenant authorization and representative telemetry reads.
For local Timescale policy and aggregate verification, use:

```bash
pnpm db:verify:telemetry
```

That command exercises the active database, not the isolated restore. Document
the backup time, restore start/end, result, schema version, and observed RPO/RTO.

## Restore the primary database

This operation destroys the current `smart_house` database. Assign an incident
owner, stop API and worker processes to prevent writes, retain the failed
database or take a final backup when possible, and first complete the isolated
restore test above. Then run:

```bash
CONFIRM_RESTORE=smart_house pnpm ops:restore -- backups/smart_house-<UTC timestamp>.dump smart_house --replace
pnpm db:verify:telemetry
```

Restart PostgreSQL consumers in this order: Redis if it was restored or cleared,
worker, API, then web. Confirm `/api/health`, worker MQTT connection, a safe
telemetry write, and pending outbox/notification work. Redis Streams and MQTT
sessions are not restored by this procedure; they rebuild from the durable
PostgreSQL outbox and reconnecting clients. Account for resulting at-least-once
delivery with `eventId` deduplication.

Do not run `docker compose down --volumes` as a restore step: it removes all
local persistent service state and is not a tested recovery mechanism.
