# Infraestructura local

Los servicios de este directorio son exclusivos para desarrollo local. Mosquitto facilita pruebas MQTT iniciales; no representa una decisión de broker para producción.

## Servicios

| Servicio | Puerto | Credenciales locales |
| --- | --- | --- |
| PostgreSQL 17 | 5432 | `smart_house` / `smart_house` |
| Redis 7 | 6379 | Sin contraseña, solo local |
| Mosquitto 2 | 1883 | Anónimo, solo local |
| OpenTelemetry Collector | 4318 | Receptor OTLP HTTP y salida `debug` local |

## Uso

```bash
pnpm infra:up
pnpm db:migrate
pnpm infra:down
```

Los volúmenes persisten entre reinicios. Para borrar datos locales, ejecuta `docker compose -f infra/local/docker-compose.yml down --volumes`.
# Infraestructura local

`pnpm infra:up` inicia PostgreSQL/TimescaleDB, Redis, Mosquitto, OpenTelemetry y Keycloak.

## Keycloak

- Consola administrativa: `http://localhost:8080/admin`
- Administrador local: `admin` / `admin`
- Realm importado: `smart-house`
- Cliente público PKCE: `smart-house-web`

El realm permite autorregistro, recuperación de contraseña y solicita configurar OTP. Estas credenciales son exclusivamente para desarrollo local; producción debe usar secretos administrados y una instancia de Keycloak operada.

## Correo local

Mailpit recibe los correos de recuperación sin enviarlos fuera del equipo. Su bandeja está disponible en `http://localhost:8025`; Keycloak debe usar `mailpit:1025` sin autenticación.
