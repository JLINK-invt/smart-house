# Database migrations

`0001_initial.sql` establishes the MVP data boundary. `0002_timescale_telemetry.sql` converts telemetry into a TimescaleDB hypertable with 90-day retention and compression after seven days. Every tenant-owned table stores `organization_id`; application queries must always authorize and filter by it.

Run the migration locally with `pnpm infra:up` followed by `pnpm db:migrate`. The script is idempotent for local iteration.

The target production store is PostgreSQL with TimescaleDB. The initial schema stays compatible with PostgreSQL while the telemetry migration that creates the hypertable, retention, compression and continuous aggregates is added for the vertical spike.

Production rollouts use additive migrations. Rollback means deploying compatible code and restoring from a verified backup when data removal is required; destructive down migrations are not run automatically.
