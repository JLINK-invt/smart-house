# ADR 0004: Contratos y validacion runtime

- Estado: Accepted
- Contexto: web, API, worker y dispositivos cruzan limites con datos no confiables.
- Decision: `packages/contracts` contiene esquemas agnosticos de framework y tipos inferidos. Todo limite valida en runtime; NestJS conserva la autoridad de autorizacion y validacion de entrada. HTTP, MQTT y realtime se versionan de forma explicita.
- Consecuencias: se evita filtrar entidades de persistencia o DTOs NestJS a la web. Los cambios incompatibles requieren version o rollout compatible.
- Alternativas rechazadas: solo tipos TypeScript, entidades ORM como contrato y validacion exclusiva del cliente.
