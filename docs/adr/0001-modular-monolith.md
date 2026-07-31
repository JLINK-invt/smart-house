# ADR 0001: Monolito modular Next.js y NestJS

- Estado: Accepted
- Contexto: el MVP necesita una web, una API de negocio y procesos de ingesta sin asumir la carga ni los limites operativos que justificarian microservicios.
- Decision: mantener `apps/web` como capa de presentacion y `apps/api` como propietario de negocio, autorizacion y datos. Los modulos NestJS se organizan por capacidad. Un worker de ingesta se agregara como proceso independiente solo para aislar el consumo MQTT de las solicitudes HTTP.
- Consecuencias: despliegue y depuracion simples; los limites de dominio deben mantenerse con contratos e interfaces explicitas. No se introduce bus de eventos ni multiples bases por anticipacion.
- Alternativas rechazadas: microservicios por dominio, BFF separado y acceso directo de Next.js a datos de producto.
