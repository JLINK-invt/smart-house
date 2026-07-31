# Simulador MQTT

Simulador local y autocontenido para dos dispositivos del tenant `demo`:

- `temp-001` publica temperatura cada 30 segundos.
- `relay-001` recibe comandos `relay.set`, publica su estado y responde con un ACK.

Todos los mensajes MQTT usan QoS 1. El broker incluido es solo para desarrollo local: escucha en `127.0.0.1`, permite conexiones anonimas y no utiliza TLS. Produccion requerira TLS/mTLS, credenciales por dispositivo y ACL por topico.

## Requisitos

- Node.js 22 o superior.
- pnpm 11.10.0.
- Docker con Docker Compose.

## Inicio rapido

Desde la raiz del repositorio:

```bash
pnpm install
pnpm simulator:broker:up
pnpm simulator
```

Tambien se puede trabajar directamente desde esta carpeta:

```bash
pnpm broker:up
pnpm start
```

El simulador publica inmediatamente una lectura y continua con el intervalo configurado. Usa `Ctrl+C` para cerrarlo de forma ordenada.

## Variables

Consulta `.env.example`. Los valores principales son:

| Variable | Valor por defecto | Uso |
| --- | --- | --- |
| `MQTT_URL` | `mqtt://localhost:1883` | Direccion del broker |
| `MQTT_CLIENT_ID` | `smart-house-simulador` | Identidad local del cliente |
| `TENANT_ID` | `demo` | Tenant simulado |
| `TEMPERATURE_DEVICE_ID` | `temp-001` | Sensor de temperatura |
| `RELAY_DEVICE_ID` | `relay-001` | Relay controlable |
| `PUBLISH_INTERVAL_MS` | `30000` | Intervalo de temperatura |
| `COMMAND_PROCESSING_DELAY_MS` | `100` | Latencia artificial del relay |
| `PUBLISH_ONCE` | `false` | Publica una lectura y termina |
| `ENABLE_SIMULATION_PROFILES` | `false` | Seleccion de perfil preparada |
| `SIMULATION_PROFILE` | `normal` | Perfil seleccionado |

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
  -q 1 \
  -t tenants/demo/devices/relay-001/commands \
  -m '{"commandId":"cmd-001","nonce":"nonce-001","tenantId":"demo","deviceId":"relay-001","commandType":"relay.set","issuedAt":"2026-07-31T12:00:00Z","expiresAt":"2099-07-31T12:00:30Z","payload":{"state":"on"}}'
```

Observar telemetria y ACK:

```bash
docker compose -f simulador/docker-compose.yml exec -T mqtt mosquitto_sub \
  -h localhost \
  -v \
  -q 1 \
  -t 'tenants/demo/devices/+/+'
```

El relay valida el contrato, tenant, dispositivo y expiracion. Un `commandId` repetido no vuelve a cambiar el estado: se republica el ACK anterior.

## Perfiles preparados

El registro y el motor de perfiles estan creados, pero permanecen desactivados por defecto y todavia no alteran el flujo de los dispositivos.

| Perfil | Comportamiento preparado |
| --- | --- |
| `normal` | Trafico estable |
| `duplicate-messages` | Mensajes MQTT duplicados |
| `invalid-payloads` | Payloads invalidos |
| `unstable-network` | Desconexion y reconexion |
| `relay-failures` | Latencia y fallos del relay |

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
