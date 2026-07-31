# Arquitectura

## Decision inicial

Smart House comienza como un monolito modular en un monorepo pnpm. Next.js entrega la experiencia web, NestJS concentra negocio, autorizacion y consultas, y un worker NestJS independiente consume la ingesta MQTT.

Esta decision reduce el costo operativo para un solo desarrollador y mantiene limites que permiten separar componentes mas adelante solo si existe una necesidad demostrable.

## Flujo de datos

```text
Navegador -> apps/web -> HTTP y WebSocket -> apps/api -> PostgreSQL y TimescaleDB
Dispositivo o simulador -> MQTT TLS -> broker -> apps/ingestion-worker -> PostgreSQL y TimescaleDB
apps/api y worker -> Redis -> eventos, realtime y alertas
apps/api y worker -> packages/contracts y packages/observability
```

- `apps/web` puede importar `@smart-house/contracts`, pero nunca modulos NestJS ni clientes de base de datos.
- `apps/api` y `apps/ingestion-worker` pueden importar contratos y observabilidad compartida; ambos usan el limite de datos comun sin compartir logica de negocio mutable.
- `packages/contracts` no puede importar codigo desde ninguna aplicacion.
- Cada nueva capacidad de negocio debe vivir en un modulo vertical de `apps/api/src/<capacidad>`.
- Los componentes permanecen en `apps/web` hasta que exista reutilizacion real que justifique un paquete de UI.

## Contratos

Los limites HTTP usan esquemas Zod independientes de framework. La API conserva la autoridad sobre la validacion de entradas y la autorizacion; compartir tipos no sustituye esas comprobaciones en tiempo de ejecucion.

## Decisiones aceptadas

- PostgreSQL con TimescaleDB para transacciones y series temporales.
- Redis para eventos internos, realtime y escalado posterior.
- MQTT sobre TLS/mTLS, ACL por topico, QoS 1 e idempotencia.
- WebSocket Gateway autorizado para actualizaciones en vivo.
- Outbox y consumidores idempotentes para efectos asincronos durables.
- OpenTelemetry, logs estructurados, metricas y correlation ID de extremo a extremo.

El proveedor concreto de OIDC permanece pospuesto. La arquitectura exige OIDC/OAuth 2.1, PKCE y MFA para roles privilegiados, pero no selecciona proveedor hasta retomar identidad.
