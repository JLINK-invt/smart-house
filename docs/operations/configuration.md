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

`API_URL` debe ser una URL absoluta. `PORT` debe ser un entero entre 1 y 65535; la API rechaza valores invalidos antes de abrir el puerto.

Las variables de OIDC, broker MQTT, PostgreSQL/TimescaleDB, Redis y exportacion OTLP se añadiran con los modulos que las consuman. Cada una debe incluir propietario, clasificacion de secreto, entorno de uso y mecanismo de rotacion. El proveedor concreto de OIDC permanece pospuesto.
