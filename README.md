# Smart House

Monorepo para el producto Smart House, organizado como un monolito modular con dos aplicaciones y un contrato compartido.

## Estructura

```text
apps/
  web/           Next.js: interfaz y estado de presentacion
  api/           NestJS: negocio, autorizacion y acceso a datos
  ingestion-worker/ NestJS standalone: consumo MQTT y normalizacion futura
packages/
  contracts/     Esquemas de transporte independientes de framework
contracts/
  openapi/       Especificaciones HTTP versionadas
infra/
  local/         PostgreSQL, Redis y MQTT para desarrollo
docs/
  architecture.md
  adr/
  iot/hardware-inventory.md
  product/mvp-scope.md
  security/threat-model.md
  security/authorization-matrix.md
  operations/configuration.md
  operations/slo-baseline.md
```

No se incluye una base de datos ni autenticacion hasta definir los primeros requisitos de producto. Cuando se agreguen, la API sera su unica propietaria.

## Requisitos

- Node.js 22 o superior
- pnpm 11.10.0

## Inicio rapido

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000/api/health

La web usa `http://localhost:4000` por defecto. Para cambiarlo, copia `apps/web/.env.example` como `apps/web/.env.local` y modifica `API_URL`.

## Validacion

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Los comandos se ejecutan desde la raiz para respetar el orden de dependencias del workspace.

## Simulador MQTT

El simulador local de `temp-001` y `relay-001` se encuentra en [`simulador/`](simulador/README.md). Para levantar su broker Mosquitto e iniciarlo:

```bash
pnpm simulator:broker:up
pnpm simulator
```
