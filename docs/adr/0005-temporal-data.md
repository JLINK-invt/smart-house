# ADR 0005: PostgreSQL y TimescaleDB para datos temporales

- Estado: Accepted
- Contexto: el MVP combina transacciones multi-tenant, auditoria y telemetria con retencion prolongada.
- Decision: usar PostgreSQL como base primaria y evaluar TimescaleDB para hypertables, compresion, retencion y agregados continuos tras el spike de volumen. Todas las entidades operativas incluyen `organizationId` y se evalua RLS como defensa adicional.
- Consecuencias: una base simplifica transacciones, auditoria y operaciones iniciales. Se requiere probar consulta, retencion y restauracion con volumen representativo.
- Alternativas rechazadas: varias bases desde el inicio y almacenamiento temporal sin estrategia de retencion.
