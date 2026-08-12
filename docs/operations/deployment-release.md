# Deployment and release runbook

This runbook promotes the same tested commit for the independently deployable
web, API, and ingestion worker. The repository currently supplies local Docker
dependencies, not production manifests, registries, or secret management. A
production release owner must map each step to the chosen platform without
placing secrets in Git, image arguments, frontend variables, or logs.

## Preflight

1. Start from the intended commit and record its SHA, release owner, change
   list, migration list, and rollback owner.
2. Run `pnpm install --frozen-lockfile`, `pnpm check:supply-chain`, `pnpm lint`,
   `pnpm typecheck`, `pnpm test`, and `pnpm build`.
3. Build immutable web, API, and worker artifacts from that commit. Promote the
   same artifact digest between environments; do not rebuild from a tag.
4. Review configuration per environment. API requires valid `DATABASE_URL`,
   `REDIS_URL`, `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`, and `WEB_ORIGIN`.
   Worker requires those database/Redis URLs plus `MQTT_URL` (`mqtts://`), CA,
   client certificate/key paths, and SMTP values. Web needs only its API URL
   and public OIDC client configuration, never a database, MQTT, SMTP, or
   private-key secret.
5. Obtain secrets from the deployment platform at runtime. Confirm certificate
   and database-password rotation owners and that logs redact values.
6. Confirm a successful, recent backup and an isolated restore test as described
   in `backup-restore.md`. Confirm database capacity and broker/Redis health.

## Deploy

1. Put the release under observation and pause nonessential bulk work. Keep the
   previous web/API/worker artifact addresses available.
2. Run additive migrations once, using a migration-capable job with exclusive
   release ownership. Existing `packages/database/migrate.sh` applies ordered
   files idempotently and fails on SQL errors. Never run destructive down
   migrations automatically.
3. Deploy API instances using the validated environment. Wait for
   `GET /api/health` before sending normal traffic.
4. Deploy the worker with the new API-compatible schema and mTLS material. Wait
   for its database, Redis, and MQTT connection; only then scale it to normal
   capacity. Keep its stable MQTT client ID and QoS/session configuration.
5. Deploy the web after API health is stable. Verify server-side API access,
   login redirect, and a nonprivileged page before exposing it broadly.
6. Verify broker mTLS/ACL behavior, then monitor telemetry p95, worker errors,
   pending outbox/notification work, database errors, and command delivery for
   at least one normal processing window.

For a local release rehearsal:

```bash
pnpm mqtt:certs
pnpm infra:up
pnpm db:migrate
pnpm build
pnpm dev
```

In another terminal, check `curl --fail http://localhost:4000/api/health` and
use the simulator only after the worker has connected.

## Rollback

1. Stop promotion and capture logs, metrics, migration version, and artifact
   digests. Do not delete pending outbox, notification, or audit rows.
2. If the schema change is additive and the previous code remains compatible,
   redeploy the prior API, worker, and web artifacts in that order after the
   dependencies are healthy.
3. If data was removed, transformed incompatibly, or the prior code cannot use
   the migrated schema, stop writers and restore the verified pre-release backup
   with `backup-restore.md`. This is a data recovery incident, not a down
   migration.
4. After rollback, verify API health, login, MQTT ingestion, durable outbox
   drain, notifications, database extension/migration state, and affected tenant
   flows. Record the final impact, actual RPO/RTO, and the condition for retry.
