# Alcance MVP y flujos criticos

## Objetivo

Entregar una plataforma web multi-tenant para que organizaciones registren y operen dispositivos IoT con aislamiento estricto, telemetria observable y comandos verificables.

El MVP prioriza detectar el estado de una flota, consultar sus datos recientes, ejecutar acciones autorizadas y reaccionar ante incidentes. No intenta resolver automatizacion visual, analitica predictiva ni facturacion.

## Actores

| Actor | Responsabilidad | Limite de acceso |
| --- | --- | --- |
| Owner | Administra la organizacion, miembros y configuracion global. | Solo su organizacion; MFA obligatorio. |
| Admin | Gestiona dispositivos, credenciales, reglas y operacion. | Solo recursos de su organizacion; MFA obligatorio. |
| Operator | Monitorea, controla y atiende alertas. | No modifica miembros ni configuracion global. |
| Viewer | Consulta paneles y datos. | Sin comandos ni cambios de configuracion. |
| Device | Publica telemetria y recibe sus propios comandos. | Credencial unica y ACL minima por topico. |

## Flujos P0

### 1. Acceso y aislamiento de organizacion

1. Un usuario inicia sesion mediante OIDC/OAuth 2.1 con Authorization Code y PKCE.
2. La API valida la sesion y resuelve la membresia activa de la organizacion.
3. Cada peticion y canal en tiempo real se autoriza contra la organizacion y el recurso objetivo.
4. Una solicitud sin membresia, con rol insuficiente o con un recurso de otro tenant falla por defecto y se audita.

**Resultado esperado:** no existe lectura, escritura, suscripcion realtime, exportacion ni comando entre organizaciones.

### 2. Registro y activacion de dispositivo

1. Un Admin registra un dispositivo con tipo, capacidades y organizacion.
2. La plataforma emite un token de activacion de un solo uso y corta vigencia.
3. El dispositivo canjea el token por una identidad unica y publica telemetria mediante MQTT sobre TLS.
4. La plataforma registra la activacion y permite rotar o revocar la credencial sin eliminar el dispositivo.

**Resultado esperado:** tokens vencidos o reutilizados se rechazan; nunca se usan secretos compartidos por flota.

### 3. Ingesta y visualizacion de telemetria

1. Un dispositivo autorizado publica telemetria QoS 1 con `messageId`, marca temporal y version de esquema.
2. El worker valida tenant, identidad, topico, tamano, esquema y limites antes de persistir.
3. Mensajes duplicados son idempotentes; mensajes invalidos se rechazan sin contaminar datos.
4. La API expone un snapshot autorizado y distribuye actualizaciones solo a miembros del tenant.
5. El usuario consulta inventario, detalle, metricas recientes e historico basico.

**Resultado esperado:** la latencia p95 entre ingesta y panel es menor de dos segundos bajo la carga baseline.

### 4. Comando remoto verificable

1. Un Operator o Admin solicita un comando compatible con las capacidades del dispositivo.
2. La API autoriza, aplica rate limit, registra auditoria y persiste el comando antes de publicarlo.
3. El dispositivo recibe un comando con `commandId`, `nonce`, emision y expiracion; lo ejecuta de forma idempotente.
4. Un ACK o error actualiza el estado a `acknowledged` o `failed`.
5. Sin ACK dentro del plazo, el comando pasa a `expired`; publicar nunca equivale a exito.

**Resultado esperado:** el usuario siempre conoce un resultado verificable, sin ejecuciones repetidas accidentales.

### 5. Deteccion y atencion de alertas

1. Eventos persistidos se evaluan contra reglas de umbral, duracion u offline.
2. La evaluacion aplica histeresis, cooldown y deduplicacion por incidente.
3. La plataforma entrega alertas in-app y por correo segun severidad y preferencias.
4. Un usuario autorizado reconoce, resuelve o silencia una alerta; cada transicion queda auditada.

**Resultado esperado:** una desconexion o condicion sostenida abre una sola alerta accionable y su recuperacion la resuelve.

## Incluido

- Registro, login, logout, recuperacion y MFA para Owner y Admin.
- Organizaciones, membresias, RBAC y autorizacion por recurso.
- Alta, activacion, asignacion, rotacion y revocacion de dispositivos.
- Estado online/offline, ultima conexion, metadatos y capacidades.
- Ingesta MQTT validada, normalizada, idempotente y con sello temporal.
- Inventario, detalle, metricas recientes e historico basico.
- Actualizacion realtime autorizada.
- Comandos con estados `pending`, `sent`, `acknowledged`, `failed` y `expired`.
- Alertas por umbral, duracion y dispositivo offline.
- Notificaciones in-app y por correo.
- Auditoria de accesos, permisos, dispositivos, comandos y exportaciones.
- Exportacion CSV autorizada, acotada y con rate limit.

## Excluido

- Aplicaciones moviles nativas.
- Editor visual de automatizaciones.
- Mantenimiento predictivo o machine learning.
- Marketplace de integraciones.
- Actualizacion OTA de firmware.
- Facturacion, planes comerciales y gemelos digitales complejos.

## Baseline y criterios de exito

| Dimension | Objetivo inicial |
| --- | --- |
| Perfil de carga aprobado | 10 casas simuladas: 1 gateway, 1 medidor, 4 sensores y 4 relays por casa |
| Mensajes | 190 por minuto; 273.600 por dia |
| Latencia de telemetria p95 | Menor de 3 segundos |
| Actualizacion de UI p95 | Menor de 5 segundos |
| ACK de comando p95 | Menor de 5 segundos para dispositivo online |
| Retencion de detalle | 90 dias |
| Retencion de agregados | 2 anos |
| Durabilidad | QoS 1 e idempotencia |
| Disponibilidad mensual | 99,5 por ciento |
| RPO | Menor de 15 minutos |
| RTO | Menor de 1 hora |
| Accesibilidad | WCAG 2.2 AA en flujos principales |

## Decisiones confirmadas de producto

- **Dispositivos:** familia Tuya de sensores de temperatura y humedad, relays y focos; el perfil del spike tambien incluye un gateway y un medidor de energia por casa simulada.
- **Conectividad:** Wi-Fi para la primera flota; MQTT sobre TLS es el protocolo objetivo de integracion.
- **Telemetria inicial:** gateway cada 60 segundos, medidor de energia cada 10 segundos, sensores cada 30 segundos y relays al cambiar de estado con heartbeat cada 60 segundos.
- **Comandos iniciales:** encender/apagar rele o foco, reiniciar dispositivo y cambiar intervalo de reporte.
- **Comandos criticos:** reinicio y cambio de configuracion; requieren confirmacion de Admin.
- **Region del piloto:** Mexico, dentro de Latinoamerica.
- **Piloto:** 20 dispositivos, 3 usuarios y duracion de 2 semanas.

## Informacion tecnica pendiente

- Modelos exactos, revisiones de hardware y firmware de cada dispositivo Tuya.
- Muestras reales de payload, limites de tamano y comportamiento de rafaga.
- Broker MQTT compatible y soporte efectivo de TLS/mTLS por modelo.
- Catalogo final de capacidades y compatibilidad de comandos por dispositivo.
- Requisitos regulatorios aplicables a la residencia de datos en Mexico.

## Aprobacion

Este documento cubre el entregable tecnico de la tarea. La tarea solo puede marcarse como `Done` cuando producto y seguridad confirmen los actores, flujos P0, limites y criterios de exito.
