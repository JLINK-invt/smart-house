# Arquitectura

## Decision inicial

Smart House comienza como un monolito modular en un monorepo pnpm. Next.js entrega la experiencia web y NestJS concentra los datos, las reglas de negocio y las futuras decisiones de autenticacion y autorizacion.

Esta decision reduce el costo operativo para un solo desarrollador y mantiene limites que permiten separar componentes mas adelante solo si existe una necesidad demostrable.

## Flujo de datos

```text
Navegador -> apps/web -> HTTP -> apps/api -> base de datos futura
                    \-> packages/contracts <-/
```

- `apps/web` puede importar `@smart-house/contracts`, pero nunca modulos NestJS ni clientes de base de datos.
- `apps/api` puede importar `@smart-house/contracts` y es la unica aplicacion que accedera a datos persistentes.
- `packages/contracts` no puede importar codigo desde ninguna aplicacion.
- Cada nueva capacidad de negocio debe vivir en un modulo vertical de `apps/api/src/<capacidad>`.
- Los componentes permanecen en `apps/web` hasta que exista reutilizacion real que justifique un paquete de UI.

## Contratos

Los limites HTTP usan esquemas Zod independientes de framework. La API conserva la autoridad sobre la validacion de entradas y la autorizacion; compartir tipos no sustituye esas comprobaciones en tiempo de ejecucion.

## Decisiones diferidas

- Base de datos y ORM.
- Proveedor de identidad y modelo de permisos.
- Procesamiento en segundo plano.
- Despliegue y observabilidad externa.

Estas decisiones se tomaran con requisitos concretos para evitar infraestructura y abstracciones prematuras.
