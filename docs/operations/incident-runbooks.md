# Incident runbooks

These runbooks apply to the current deployment boundary: the API, web, and
ingestion worker run as workspace processes; PostgreSQL/TimescaleDB, Redis, and
Mosquitto run through `infra/local/docker-compose.yml`. The local broker is a
development implementation, not a production broker decision. Record the
incident timeline, operator, commands, affected organizations, and correlation
or event IDs. Do not put tokens, private keys, raw exports, or personal data in
the ticket.

## First response

1. Assign an incident owner and state its impact and start time.
2. Preserve logs and current Compose status before restarting services.
3. Stop only the affected ingress or component; do not run `down --volumes`.
4. Treat a suspected credential or data disclosure as a security incident and
   restrict access before investigating further.

Useful local checks:

```bash
docker compose -f infra/local/docker-compose.yml ps
docker compose -f infra/local/docker-compose.yml logs --since 15m postgres redis mqtt
curl --fail --show-error http://localhost:4000/api/health
curl --fail --show-error http://localhost:3000
```

## Compromised account or certificate

**Contain.** Disable the user in the identity provider, revoke active sessions,
and remove privileged memberships if the IdP cannot immediately block access.
For a device or worker certificate, stop the affected device/worker, remove its
ACL access, issue a new key pair and certificate, and restart or reload the
broker. Rotate any related database, Redis, SMTP, or OIDC secret.

**Local certificate procedure.** The local Mosquitto setup has no CRL and does
not disconnect an already authenticated session. `pnpm mqtt:certs` regenerates
every local identity, so stop the broker and simulators first, regenerate, then
start the broker and worker again:

```bash
pnpm simulator:broker:down
pnpm mqtt:certs
pnpm simulator:broker:up
```

This is intentionally disruptive and only valid for local development. A
production broker must enforce a CRL or dynamic revocation and reload it before
the incident is considered contained.

**Eradicate and recover.** Audit login, membership, credential, command, and
device events for the affected organization and time window. Re-enroll devices
with new credentials, force affected users to authenticate again, and verify
the old identity cannot authenticate or publish/subscribe. Preserve the old
credential identifier and incident evidence; never retain its private key.

## Suspected data leak

**Contain.** Stop the exposed export, link, account, integration, or service
credential. Reduce the affected account to least privilege and preserve access
logs, request IDs, and the exact exported object without redistributing it.

**Scope.** Identify organizations, records, and time range using audit events
and API/worker logs. Check tenant filters and authorization changes before
resuming traffic. If a backup was exposed, treat every credential contained in
it as exposed and rotate it; encrypted backup access keys are also in scope.

**Recover.** Patch and test the authorization or redaction failure, deploy it
through `deployment-release.md`, rotate credentials, notify the incident owner
for legal/privacy handling, and monitor for repeated access. Do not delete
audit evidence to remove the exposure.

## MQTT broker down

**Confirm and contain.** Determine whether the listener, TLS material, ACL, or
network is failing. The worker reconnects with persistent MQTT v5 QoS 1
sessions; avoid repeatedly restarting it while the broker is unavailable.

```bash
docker compose -f infra/local/docker-compose.yml ps mqtt
docker compose -f infra/local/docker-compose.yml logs --since 15m mqtt
docker compose -f infra/local/docker-compose.yml exec -T mqtt \
  mosquitto_sub -h localhost -p 8883 --cafile /mosquitto/certs/ca.crt \
  --cert /mosquitto/certs/platform-worker.crt --key /mosquitto/certs/platform-worker.key \
  -t '$SYS/broker/uptime' -C 1 -W 3
```

Restart only the broker after checking configuration and certificate file modes:

```bash
docker compose -f infra/local/docker-compose.yml restart mqtt
docker compose -f infra/local/docker-compose.yml up -d --wait mqtt
```

After recovery, verify a worker reconnect, a simulator publication, persisted
telemetry, and command delivery. QoS 1 and the telemetry outbox are
at-least-once: investigate duplicate effects by stable `eventId`, rather than
assuming exactly-once delivery.

## Backlog growing

**Confirm.** Inspect worker errors, database health, Redis, and pending work.
The worker reports separate outbox, command, and notification queues; do not
delete rows to make a dashboard look healthy.

```bash
docker compose -f infra/local/docker-compose.yml exec -T postgres psql -X -U smart_house -d smart_house -c "
SELECT topic, count(*), min(created_at) AS oldest
FROM outbox_events WHERE processed_at IS NULL GROUP BY topic ORDER BY oldest;"
docker compose -f infra/local/docker-compose.yml exec -T postgres psql -X -U smart_house -d smart_house -c "
SELECT status, count(*), min(available_at) AS oldest
FROM notification_jobs GROUP BY status ORDER BY status;"
```

**Recover.** Restore Redis or broker connectivity first, then restart one worker
instance and allow it to drain. Reduce producers or simulator rate if database
latency is the constraint. Inspect dead-letter notification and tenant deletion
jobs, correct the underlying error, and requeue only an identified job with a
recorded reason. Verify pending counts decline, worker errors stop, and no
organization is starved.

## PostgreSQL or TimescaleDB degradation

**Contain.** Stop load generation and any nonessential exports. Do not restart
Postgres or run migrations until capacity, locks, disk, and error logs are
captured. Take a backup before any destructive repair when the database remains
readable.

```bash
docker compose -f infra/local/docker-compose.yml exec -T postgres pg_isready -U smart_house -d smart_house
docker compose -f infra/local/docker-compose.yml exec -T postgres psql -X -U smart_house -d smart_house -c "
SELECT now() - query_start AS age, state, wait_event_type, query
FROM pg_stat_activity WHERE state <> 'idle' ORDER BY query_start;"
docker compose -f infra/local/docker-compose.yml exec -T postgres psql -X -U smart_house -d smart_house -c "
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;"
```

**Recover.** Resolve disk exhaustion, lock contention, or the failed dependency;
then restart the worker before restoring normal producer rate. For corruption or
unrecoverable data loss, use the tested procedure in `backup-restore.md`.
Validate the Timescale extension, schema migrations, telemetry writes, and
aggregate verification before declaring recovery. Retain evidence and record
the actual RPO/RTO against `slo-baseline.md`.
