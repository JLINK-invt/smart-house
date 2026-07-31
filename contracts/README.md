# Versioned transport contracts

- `openapi/openapi.yaml` defines the stable HTTP surface available today.
- `asyncapi/telemetry.v1.yaml` defines MQTT telemetry for the simulated gateway profile.
- `packages/contracts` provides framework-free runtime schemas used by applications.
- The first MQTT and AsyncAPI contracts use the approved simulated profile: gateway, energy meter, temperature sensors and relays. Hardware-specific Tuya payloads remain versioned separately when samples are available.

Breaking transport changes require a new version or a compatible rollout.
