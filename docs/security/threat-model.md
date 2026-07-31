# Threat model STRIDE

**Estado:** Accepted para el MVP.

## Alcance

Este modelo cubre los limites de confianza del MVP: navegador y web, API, proveedor de identidad, broker MQTT, dispositivos, worker de ingesta, almacenamiento, realtime, comandos, alertas y exportaciones.

Los datos de telemetria, comandos y auditoria pertenecen a una organizacion. Ningun componente puede inferir el tenant solo desde datos controlados por el cliente o dispositivo.

## Activos a proteger

- Identidades, sesiones, roles y membresias de usuarios.
- Credenciales y certificados unicos de dispositivos.
- Aislamiento de organizaciones y autorizacion por recurso.
- Integridad, disponibilidad y orden de telemetria y comandos.
- Datos de telemetria, exportaciones, auditoria y configuracion.
- Secretos de infraestructura y claves de firma.

## Limites de confianza

```text
Usuario -> Web -> API -> PostgreSQL/Redis
Dispositivo -> MQTT sobre TLS -> Broker -> Worker -> PostgreSQL/Redis
API -> Broker MQTT
API -> WebSocket -> Usuario autorizado
```

Todo cruce de limite requiere autenticacion, validacion de entrada, autorizacion explicita y registro seguro de auditoria.

## Amenazas y controles

| Flujo | STRIDE | Amenaza | Control requerido | Responsable | Riesgo residual |
| --- | --- | --- | --- | --- | --- |
| Login OIDC | Spoofing | Robo o reutilizacion de sesion. | Authorization Code con PKCE, cookies HttpOnly/Secure/SameSite, rotacion y MFA para Owner/Admin. | Identity | Compromiso del IdP o del dispositivo del usuario. |
| API HTTP | Tampering | Payload o parametros alterados para cambiar tenant o recurso. | Esquemas runtime, tenant derivado de sesion, autorizacion por recurso, allowlists y errores uniformes. | API | Defectos de implementacion; pruebas negativas obligatorias. |
| API HTTP | Repudiation | Usuario niega una accion sensible. | Audit event inmutable con actor, recurso, resultado, correlacion y timestamp. | Audit | Reloj o almacenamiento de auditoria degradado. |
| API HTTP | Information disclosure | Enumeracion o lectura entre tenants. | Deny-by-default, filtros obligatorios por organizationId, respuestas no enumerables y pruebas de aislamiento. | API | Configuracion incorrecta de una ruta futura. |
| API HTTP | Denial of service | Abuso de login, exportacion o comandos. | Rate limits por riesgo, limites de rango y tamano, streaming acotado y cuotas. | Platform | Ataque volumetrico superior a la capacidad contratada. |
| API HTTP | Elevation of privilege | Viewer ejecuta comandos o cambia roles. | RBAC mas autorizacion por recurso; politicas centralizadas y pruebas de escalada. | Identity | Matriz de permisos no aprobada o incompleta. |
| MQTT | Spoofing | Un dispositivo se presenta como otro. | mTLS por dispositivo cuando sea posible; credencial unica rotatoria y enlace identidad-tenant-device. | IoT | Hardware sin mTLS requiere excepcion documentada. |
| MQTT | Tampering | Un payload o topico se manipula. | TLS, ACL minima, validacion de topico, schema versionado, limites y firma futura si procede. | IoT | Broker o firmware mal configurado. |
| MQTT | Repudiation | No puede probarse origen de telemetria o comando. | Identidad unica, `messageId`, `commandId`, nonce y auditoria de ingesta/publicacion. | IoT | Identidad compartida heredada. |
| MQTT | Information disclosure | Dispositivo consume comandos de otro tenant. | ACL por topico, topicos sin comodines para clientes y pruebas cruzadas. | IoT | Fallo del broker o de la plantilla ACL. |
| MQTT | Denial of service | Rafagas, payloads sobredimensionados o conexiones abusivas. | Limites de conexion, payload, frecuencia, QoS, backpressure y metricas de rechazo. | Platform | Saturacion intencional del broker. |
| MQTT | Elevation of privilege | Credencial de dispositivo permite administrar la flota. | Principio de minimo privilegio; las credenciales device no acceden a API administrativa. | IoT | Compromiso fisico del dispositivo. |
| Ingesta | Tampering | Datos invalidos corrompen historico o alertas. | Validar schema, unidad, timestamps, limites e identidad antes de persistir. | Telemetry | Conversiones de unidad incompletas. |
| Ingesta | Repudiation | Duplicados o replays causan efectos repetidos. | Idempotencia por device/messageId, nonce y retencion de deduplicacion. | Telemetry | Ventana de deduplicacion mal dimensionada. |
| Comandos | Tampering | Comando peligroso o incompatible. | Catalogo versionado, validacion de payload/capacidad, expiracion y confirmacion adicional para criticos. | Commands | Clasificacion de comandos criticos pendiente. |
| Comandos | Repudiation | Exito asumido sin prueba del dispositivo. | Persistir antes de publicar; estado exitoso solo tras ACK correlacionado. | Commands | ACK falso desde dispositivo comprometido. |
| Realtime | Information disclosure | Socket suscrito a tenant ajeno. | Autenticacion al conectar, canales por tenant/recurso, autorizacion en cada suscripcion y resync HTTP. | API | Adaptador multi-replica mal configurado. |
| Datos | Information disclosure | Consulta o backup filtra otra organizacion. | organizationId obligatorio, RLS evaluado, cifrado, control de acceso y restauracion aislada. | Data | Error de migracion o acceso operativo privilegiado. |
| Exportacion | Information disclosure | CSV contiene datos excesivos o formulas ejecutables. | Autorizacion, rango maximo, rate limit, streaming y escape de formulas. | API | Descarga posterior fuera de control de la plataforma. |
| Logs | Information disclosure | Credenciales o payloads sensibles aparecen en logs. | Logging estructurado con redaccion, allowlist de campos y revision automatizada. | Observability | Datos sensibles nuevos no clasificados. |

## Controles P0 antes de piloto

1. Aislamiento de tenant probado en HTTP, WebSocket, exportacion, comandos y MQTT.
2. OIDC con PKCE, MFA privilegiado, sesiones seguras y rate limiting.
3. Credenciales unicas de dispositivo, TLS, ACL por topico y revocacion.
4. Validacion runtime, limites de payload y deduplicacion para la ingesta.
5. Comandos con autorizacion, auditoria, nonce, expiracion y ACK obligatorio.
6. Auditoria inmutable y logs sin secretos.
7. Pruebas de replay, topicos prohibidos, escalada de privilegios y abuso.

## Prioridades aprobadas

- **Criticas:** aislamiento entre tenants, acceso MQTT por dispositivo, replay de comandos, escalada de privilegios y robo de credenciales.
- **Altas:** telemetria invalida o manipulada, filtracion mediante WebSocket, saturacion o abuso y auditoria incompleta.
- **Controles base:** OIDC/OAuth 2.1 con PKCE, MFA para roles privilegiados, RBAC por tenant y recurso, TLS/mTLS, ACL MQTT, validacion de esquemas, idempotencia, rate limiting, auditoria inmutable y correlation ID.

## Riesgos abiertos y decisiones requeridas

- Definir proveedor OIDC y controles operativos de cuentas privilegiadas.
- Definir broker MQTT y confirmar mTLS por modelo de hardware.
- Definir region, retencion y obligaciones regulatorias.
- Clasificar comandos criticos y su mecanismo de aprobacion adicional.
- Validar RLS frente a filtro de aplicacion con pruebas de aislamiento.

## Revision

Security debe revisar este modelo al cerrar cada limite de confianza nuevo, al integrar hardware real y antes del piloto. Los riesgos P0 sin mitigacion validada bloquean el piloto y produccion.
