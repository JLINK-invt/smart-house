# Database migrations

`0001_initial.sql` establishes the MVP data boundary. `0002_timescale_telemetry.sql` converts telemetry into a TimescaleDB hypertable with 90-day retention and compression after seven days. Every tenant-owned table stores `organization_id`; application queries must always authorize and filter by it.

Run the migration locally with `pnpm infra:up` followed by `pnpm db:migrate`. The script is idempotent for local iteration.

The target production store is PostgreSQL with TimescaleDB. The initial schema stays compatible with PostgreSQL while the telemetry migration that creates the hypertable, retention, compression and continuous aggregates is added for the vertical spike.

Production rollouts use additive migrations. Rollback means deploying compatible code and restoring from a verified backup when data removal is required; destructive down migrations are not run automatically.

`0006_telemetry_normalization.sql` adds telemetry schema version, original
value/unit, and time-quality metadata without changing previously applied
migrations. Existing rows are retained and backfilled as `legacy`.

`0007_outbox_relay.sql` adds the partial ordering index used to relay pending
outbox events deterministically.

`0008_timescale_telemetry_aggregates.sql` adds tenant/device/metric history
indexes and materialized-only continuous aggregates for 5-minute and 1-hour
buckets. Temperature is normalized to Celsius before persistence and exposes
average, minimum, maximum, and sample count. Relay state remains the canonical
`0`/`1` value and deliberately has no average; its aggregates expose first and
last state, first and last sample time, and sample count.

Raw telemetry is compressed after 7 days and retained for 90 days. Continuous
aggregates refresh the preceding 7 days (excluding the current incomplete
bucket) and are retained independently for 2 years. Queries older than 90 days
must use the aggregate matching the required resolution. Because the views are
materialized-only, the current 5-minute or 1-hour bucket is intentionally not
visible until it is complete and refreshed.

Apply and verify the policy, result semantics, plans, and local latency target:

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:verify:telemetry
```

The verification uses fixed, isolated benchmark tenant/device IDs, seeds 30
days of representative temperature and relay data, refreshes all four
aggregates, checks their results and policies, prints `EXPLAIN (ANALYZE,
BUFFERS)` plans, and enforces a local historical aggregate latency target of
500 ms. TimescaleDB does not allow manual continuous-aggregate refresh inside a
transaction, so the script explicitly deletes the seed rows and refreshes the
same windows again to remove benchmark materializations. It also removes stale
benchmark IDs at startup, making reruns the documented cleanup process after an
interrupted run, and confirms that no benchmark rows remain.

`0018_tenant_data_deletion.sql` adds a durable full-tenant operational-data
deletion job. An organization owner requests it through `POST
/organizations/:organizationId/data-deletion` with `{ "confirmation": "DELETE" }`.
The ingestion worker claims jobs with `FOR UPDATE SKIP LOCKED`, retries failures
with bounded exponential backoff, and records completion or dead-letter status.
All job reads and destructive statements are scoped by `organization_id`; audit
events and the job record are retained, while membership is removed and the
organization is marked deleted to prevent later MQTT or API access from
recreating data.
