# Infraestructura local

Los servicios de este directorio son exclusivos para desarrollo local. Mosquitto facilita pruebas MQTT iniciales; no representa una decisión de broker para producción.

## Servicios

| Servicio                | Puerto | Credenciales locales                      |
| ----------------------- | ------ | ----------------------------------------- |
| PostgreSQL 17           | 5432   | `smart_house` / `smart_house`             |
| Redis 7                 | 6379   | Sin contraseña, solo local                |
| Mosquitto 2             | 8883   | mTLS con CA local y ACL por tópico        |
| OpenTelemetry Collector | 4318   | Receptor OTLP HTTP y salida `debug` local |

## Uso

```bash
pnpm mqtt:certs
pnpm infra:up
pnpm db:migrate
pnpm infra:down
```

## MQTT mTLS y ACL

`pnpm mqtt:certs` genera una CA de desarrollo y certificados en
`infra/local/certs/`; el directorio esta ignorado por Git y contiene claves
privadas que no deben compartirse. Ejecútalo antes de iniciar Mosquitto y cada
vez que quieras renovar las identidades locales.

Mosquitto solo escucha TLS en `127.0.0.1:8883`, exige certificado de cliente y
no permite conexiones anónimas ni MQTT en texto plano. El CN de cada
certificado de dispositivo es su prefijo, por ejemplo
`tenants/demo/devices/temp-001`. La ACL permite a ese dispositivo publicar
`telemetry` y `command-acks`, y consumir únicamente `commands` bajo ese mismo
prefijo. `platform-worker` consume telemetría/ACKs y publica comandos para la
flota local.

Para comprobar la política con clientes reales:

```bash
pnpm mqtt:certs
pnpm simulator:broker:up
pnpm --dir simulador test:integration
```

## Límite de revocación local

La API registra la revocación de referencias de credencial y no permite que una
referencia revocada siga activa en el flujo de provisioning. Mosquitto local no
consulta `device_credentials`: su decisión mTLS depende del certificado y de
la ACL cargados al iniciar. Por ello, revocar una credencial en la API no corta
una sesión TLS ya establecida ni invalida por sí sola un certificado local.

Para revocación efectiva de certificados, el broker debe operar con una CRL
emitida por la CA y recargarse o reiniciarse tras cada cambio (o integrarse con
un proveedor de identidad que exponga revocación dinámica). Ese mecanismo queda
fuera del entorno local actual; hasta entonces, rota el certificado y reinicia
Mosquitto al retirar una identidad local.

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
