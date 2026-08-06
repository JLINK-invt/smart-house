# Simulador MQTT

Simulador local y autocontenido para dos dispositivos del tenant `demo`:

- `temp-001` publica temperatura cada 30 segundos.
- `relay-001` recibe comandos `relay.set`, publica su estado y responde con un ACK.

Todos los mensajes MQTT usan QoS 1. El broker local escucha solo con mTLS en
`127.0.0.1:8883`; no admite conexiones anónimas ni MQTT sin TLS. El simulador
abre una conexión con certificado para cada dispositivo, de forma que Mosquitto
aplica la ACL por tópico.

## Requisitos

- Node.js 22 o superior.
- pnpm 11.10.0.
- Docker con Docker Compose.

## Inicio rapido

Desde la raiz del repositorio:

```bash
pnpm install
pnpm mqtt:certs
pnpm simulator:broker:up
pnpm simulator
```

Tambien se puede trabajar directamente desde esta carpeta:

```bash
pnpm --dir .. mqtt:certs
pnpm broker:up
pnpm start
```

El simulador publica inmediatamente una lectura y continua con el intervalo configurado. Usa `Ctrl+C` para cerrarlo de forma ordenada.

## Variables

Consulta `.env.example`. Los valores principales son:

| Variable | Valor por defecto | Uso |
| --- | --- | --- |
| `MQTT_URL` | `mqtts://localhost:8883` | Dirección TLS del broker |
| `MQTT_CA_FILE` | requerido | CA que valida el certificado del broker |
| `TEMPERATURE_MQTT_CLIENT_ID` | `smart-house-temperature` | Cliente del sensor |
| `TEMPERATURE_MQTT_CERT_FILE` / `TEMPERATURE_MQTT_KEY_FILE` | requerido | Identidad mTLS del sensor |
| `RELAY_MQTT_CLIENT_ID` | `smart-house-relay` | Cliente del relay |
| `RELAY_MQTT_CERT_FILE` / `RELAY_MQTT_KEY_FILE` | requerido | Identidad mTLS del relay |
| `TENANT_ID` | `demo` | Tenant simulado |
| `TEMPERATURE_DEVICE_ID` | `temp-001` | Sensor de temperatura |
| `RELAY_DEVICE_ID` | `relay-001` | Relay controlable |
| `PUBLISH_INTERVAL_MS` | `30000` | Intervalo de temperatura |
| `COMMAND_PROCESSING_DELAY_MS` | `100` | Latencia artificial del relay |
| `PUBLISH_ONCE` | `false` | Publica una lectura y termina |
| `ENABLE_SIMULATION_PROFILES` | `false` | Aplica el perfil seleccionado |
| `SIMULATION_PROFILE` | `normal` | Perfil seleccionado |
| `SIMULATION_SEED` | `smart-house` | Semilla reproducible para decisiones del perfil |

El proceso carga automáticamente `simulador/.env` cuando se ejecuta desde esta carpeta. No guardes credenciales reales en ese archivo.

## Topicos

```text
tenants/demo/devices/temp-001/telemetry
tenants/demo/devices/relay-001/telemetry
tenants/demo/devices/relay-001/commands
tenants/demo/devices/relay-001/command-acks
```

## Comando relay

En otra terminal, con el simulador activo:

```bash
docker compose -f simulador/docker-compose.yml exec -T mqtt mosquitto_pub \
  -h localhost \
  -p 8883 --cafile /mosquitto/certs/ca.crt --cert /mosquitto/certs/platform-worker.crt --key /mosquitto/certs/platform-worker.key \
  -q 1 \
  -t tenants/demo/devices/relay-001/commands \
  -m '{"commandId":"cmd-001","nonce":"nonce-001","tenantId":"demo","deviceId":"relay-001","commandType":"relay.set","issuedAt":"2026-07-31T12:00:00Z","expiresAt":"2099-07-31T12:00:30Z","payload":{"state":"on"}}'
```

Observar telemetria y ACK:

```bash
docker compose -f simulador/docker-compose.yml exec -T mqtt mosquitto_sub \
  -h localhost \
  -p 8883 --cafile /mosquitto/certs/ca.crt --cert /mosquitto/certs/platform-worker.crt --key /mosquitto/certs/platform-worker.key \
  -v \
  -q 1 \
  -t 'tenants/demo/devices/+/+'
```

El relay valida el contrato, tenant, dispositivo y expiracion. Un `commandId` repetido no vuelve a cambiar el estado: se republica el ACK anterior.

## Perfiles de simulacion

Los perfiles permanecen desactivados por defecto, por lo que el flujo normal conserva telemetria valida, QoS 1, mTLS/ACL y la idempotencia del relay. Al habilitarlos, afectan el trafico real del simulador. Con el mismo perfil y `SIMULATION_SEED`, las decisiones aleatorias son reproducibles.

Desde la raiz del repositorio:

```bash
ENABLE_SIMULATION_PROFILES=true SIMULATION_PROFILE=duplicate-messages SIMULATION_SEED=load-01 pnpm simulator
ENABLE_SIMULATION_PROFILES=true SIMULATION_PROFILE=invalid-payloads SIMULATION_SEED=load-01 pnpm simulator
ENABLE_SIMULATION_PROFILES=true SIMULATION_PROFILE=unstable-network SIMULATION_SEED=load-01 pnpm simulator
ENABLE_SIMULATION_PROFILES=true SIMULATION_PROFILE=relay-failures SIMULATION_SEED=load-01 pnpm simulator
ENABLE_SIMULATION_PROFILES=true SIMULATION_PROFILE=burst SIMULATION_SEED=load-01 PUBLISH_INTERVAL_MS=100 pnpm simulator
```

| Perfil | Comportamiento |
| --- | --- |
| `normal` | Trafico estable y telemetria valida |
| `duplicate-messages` | Duplica de forma determinista parte de la telemetria MQTT |
| `invalid-payloads` | Emite payloads MQTT JSON malformados de forma controlada |
| `unstable-network` | Desconecta y reconecta el sensor cada cinco ciclos |
| `relay-failures` | Retarda comandos y responde ACK fallido de forma controlada |
| `burst` | Publica 20 mensajes validos QoS 1 por ciclo para carga |

## Pruebas

Pruebas unitarias, sin infraestructura:

```bash
pnpm --dir simulador test
```

Prueba real contra Mosquitto:

```bash
pnpm simulator:broker:up
pnpm --dir simulador test:integration
```

Validacion estatica:

```bash
pnpm --dir simulador lint
pnpm --dir simulador typecheck
pnpm --dir simulador build
```

## Detener Mosquitto

```bash
pnpm simulator:broker:down
```
