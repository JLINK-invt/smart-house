# Configuracion por entorno

## Principios

- Las aplicaciones validan su configuracion al iniciar y fallan rapido ante valores invalidos.
- Los secretos no se versionan, no se exponen en `NEXT_PUBLIC_*` y no se escriben en logs.
- La web solo recibe la URL de API necesaria para hacer solicitudes desde el servidor; secretos y credenciales pertenecen a API, worker o plataforma.

## Variables actuales

| Aplicacion | Variable | Requerida | Valor local | Propietario |
| --- | --- | --- | --- | --- |
| Web | `API_URL` | No | `http://localhost:4000` | Plataforma |
| API | `NODE_ENV` | No | `development` | Plataforma |
| API | `PORT` | No | `4000` | Plataforma |
| Worker | `DEVICE_ONLINE_GRACE_PERIOD_SECONDS` | No | `90` | Plataforma |
| Worker | `DEVICE_STATUS_RECONCILIATION_INTERVAL_MS` | No | `30000` | Plataforma |
| Worker | `TELEMETRY_MAX_FUTURE_SKEW_SECONDS` | No | `300` | Plataforma |
| Worker | `TELEMETRY_LATE_AFTER_SECONDS` | No | `86400` | Plataforma |
| Worker | `TELEMETRY_OUTBOX_STREAM_KEY` | No | `telemetry.persisted.stream` | Plataforma |
| Worker | `TELEMETRY_OUTBOX_PUBSUB_CHANNEL` | No | `telemetry.persisted` | Plataforma |
| Worker | `TELEMETRY_OUTBOX_POLL_INTERVAL_MS` | No | `1000` | Plataforma |
| Worker | `TELEMETRY_OUTBOX_BATCH_SIZE` | No | `100` | Plataforma |
| Worker | `MQTT_SESSION_EXPIRY_SECONDS` | No | `3600` | Plataforma |
| Worker | `MQTT_RECONNECT_PERIOD_MS` | No | `1000` | Plataforma |
| Simulador | `MQTT_SESSION_EXPIRY_SECONDS` | No | `3600` | Plataforma |
| Simulador | `MQTT_RECONNECT_PERIOD_MS` | No | `1000` | Plataforma |

`API_URL` debe ser una URL absoluta. `PORT` debe ser un entero entre 1 y 65535; la API rechaza valores invalidos antes de abrir el puerto.

Las variables de OIDC, broker MQTT, PostgreSQL/TimescaleDB, Redis y exportacion OTLP se añadiran con los modulos que las consuman. Cada una debe incluir propietario, clasificacion de secreto, entorno de uso y mecanismo de rotacion. El proveedor concreto de OIDC permanece pospuesto.

El worker marca un dispositivo como `online` solo tras persistir telemetría válida. `DEVICE_ONLINE_GRACE_PERIOD_SECONDS` define la antigüedad máxima de su `occurredAt`; el ciclo `DEVICE_STATUS_RECONCILIATION_INTERVAL_MS` marca como `offline` los dispositivos `online` que superan ese límite. Los mensajes tardíos conservan el `last_seen_at` más reciente, pero no reactivan un dispositivo ni alteran uno `disabled`.

El worker captura `receivedAt` al recibir cada mensaje. Rechaza un `occurredAt`
que adelante `receivedAt` más de `TELEMETRY_MAX_FUTURE_SKEW_SECONDS` y marca
como `late` la telemetría cuya antigüedad supera
`TELEMETRY_LATE_AFTER_SECONDS`. Los eventos tardíos se conservan con su
`occurredAt` original y nunca reducen `last_seen_at` ni regresan presencia.

La publicación de telemetría persistida usa un outbox transaccional. El relay
entrega el mismo envelope al Redis Stream y al canal PubSub mediante
`MULTI/EXEC`, y marca el outbox después de que Redis confirma la entrega. La
garantía es **at-least-once**: una caída al guardar `processed_at` puede repetir
un evento. Los consumidores del Stream deben deduplicar por el `eventId`
estable (el UUID del outbox); `correlationId` conserva el `messageId` original.
PubSub mantiene la actualización en tiempo real, mientras el Stream permite
recuperar eventos después de una interrupción.

## Sesiones MQTT

El worker y cada cliente del simulador usan MQTT v5 con un `clientId` estable,
`clean: false`, QoS 1 y una expiración de sesión configurable mediante
`MQTT_SESSION_EXPIRY_SECONDS` (una hora localmente). Se reintentan conexiones
cada `MQTT_RECONNECT_PERIOD_MS` y las suscripciones QoS 1 se envían de nuevo de
forma idempotente tras cada conexión. No se usa QoS 2.

El Mosquitto local persiste sesiones y las guarda cada 30 segundos. Limita cada
cliente a 1000 mensajes QoS en cola, 20 mensajes en vuelo, 1 MiB de cola y
paquetes de 16 KiB; esos límites protegen memoria durante desconexiones breves.
