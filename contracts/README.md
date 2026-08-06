# Versioned transport contracts

- `openapi/openapi.yaml` defines the stable HTTP surface available today.
- `asyncapi/telemetry.v1.yaml` defines MQTT telemetry for the simulated gateway profile.
- `packages/contracts` provides framework-free runtime schemas used by applications.
- The first MQTT and AsyncAPI contracts use the approved simulated profile: gateway, energy meter, temperature sensors and relays. Hardware-specific Tuya payloads remain versioned separately when samples are available.

Breaking transport changes require a new version or a compatible rollout.

## MQTT telemetry v1

Every telemetry payload carries `schemaVersion: "1.0"`, uses an RFC 3339
timestamp with an explicit timezone, and is limited to 8 KiB. The runtime Zod
schemas and AsyncAPI examples are validated together by
`pnpm --filter @smart-house/contracts test`.

Temperature telemetry accepts `celsius` and `fahrenheit`; ingestion normalizes
both to canonical Celsius while retaining the source value and unit. Relay
state uses a canonical boolean value and the `boolean` unit.
