# SLO baseline v0.1

## Perfil de carga aprobado

- 10 casas simuladas.
- Por casa: 1 gateway, 1 medidor de energia, 4 sensores de temperatura y 4 relays.
- Frecuencias: gateway cada 60 segundos, medidor cada 10, sensores cada 30 y relays por cambio mas heartbeat cada 60.
- Carga total: 190 mensajes por minuto y 273.600 mensajes por dia.

## Objetivos iniciales

| Medida | Objetivo |
| --- | --- |
| Telemetria p95 | Menor de 3 segundos desde ingesta hasta persistencia y evento |
| Actualizacion de UI p95 | Menor de 5 segundos |
| Comandos relay p95 | Menor de 5 segundos para un dispositivo online |
| Disponibilidad mensual | 99,5 por ciento |
| Retencion detallada | 90 dias |
| Retencion agregada | 2 anos |
| RPO | Menor de 15 minutos |
| RTO | Menor de 1 hora |

El spike vertical medira estos objetivos usando correlation ID y conservara los resultados como evidencia de la siguiente iteracion.
