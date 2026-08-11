# Load and resilience baseline

This baseline uses the committed MQTT simulator and local Docker services. It is
repeatable with no load-test dependency: the `burst` profile publishes 20 valid
QoS 1 telemetry messages per cycle and its random behavior is fixed by
`SIMULATION_SEED`.

## Prerequisites

From the repository root, create the development certificates and start the
local dependencies:

```bash
pnpm mqtt:certs
pnpm infra:up
pnpm db:migrate
pnpm dev
```

Keep `pnpm dev` running in one terminal. It starts the API, ingestion worker,
and dashboard needed to measure end-to-end behavior.

## Baseline load

In a second terminal, run the simulator for five minutes. This produces 200
messages per second (20 messages every 100 ms) with deterministic message
content:

```bash
timeout 300s env ENABLE_SIMULATION_PROFILES=true SIMULATION_PROFILE=burst \
  SIMULATION_SEED=sprint-7-baseline PUBLISH_INTERVAL_MS=100 pnpm simulator
```

Record the start and end timestamps, simulator output, API/worker logs, and the
result of `pnpm db:verify:telemetry`. The run passes when the process stays
connected, no unhandled ingestion errors appear, and the p95 telemetry and UI
latencies remain within the targets in `slo-baseline.md`.

## Resilience scenarios

Run each profile for two minutes with the same command shape. The fixed seed
makes a failed run reproducible.

```bash
timeout 120s env ENABLE_SIMULATION_PROFILES=true SIMULATION_PROFILE=duplicate-messages \
  SIMULATION_SEED=sprint-7-resilience pnpm simulator
timeout 120s env ENABLE_SIMULATION_PROFILES=true SIMULATION_PROFILE=unstable-network \
  SIMULATION_SEED=sprint-7-resilience pnpm simulator
timeout 120s env ENABLE_SIMULATION_PROFILES=true SIMULATION_PROFILE=invalid-payloads \
  SIMULATION_SEED=sprint-7-resilience pnpm simulator
timeout 120s env ENABLE_SIMULATION_PROFILES=true SIMULATION_PROFILE=relay-failures \
  SIMULATION_SEED=sprint-7-resilience pnpm simulator
```

For duplicate messages, verify idempotent persistence. For unstable network,
verify that telemetry resumes after reconnect. For invalid payloads, verify that
valid telemetry continues and malformed payloads are rejected. For relay
failures, issue the documented relay command from `simulador/README.md` and
verify the failure ACK is recorded without retrying the state transition.

Stop the local environment after collecting evidence:

```bash
pnpm infra:down
```
