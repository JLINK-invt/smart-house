# Matriz de autorizacion

**Estado:** Accepted para el MVP.

## Reglas globales

- Toda peticion se rechaza por defecto hasta que una politica permita actor, accion y recurso.
- El `organizationId` se deriva de la membresia o del recurso ya autorizado; no se acepta como autoridad desde el cliente.
- Owner y Admin requieren MFA antes de acciones privilegiadas.
- Un rol no puede crear, modificar ni revocar privilegios que no posee.
- Las acciones de seguridad, membresias, credenciales, comandos, exportaciones y alertas registran auditoria.
- Device no es un rol de usuario: solo puede publicar y consumir topicos MQTT permitidos para su propia identidad.

## Leyenda

- **Allow:** permitido dentro de la organizacion activa y sujeto a autorizacion por recurso.
- **Own:** permitido solo para recursos creados o asignados al actor, cuando aplica.
- **No:** denegado.
- **MFA:** requiere MFA vigente para Owner y Admin.

## Organizacion y miembros

| Accion | Owner | Admin | Operator | Viewer |
| --- | --- | --- | --- | --- |
| Ver organizacion | Allow | Allow | Allow | Allow |
| Editar configuracion global y politicas | Allow + MFA | No | No | No |
| Invitar miembros | Allow + MFA | Allow + MFA | No | No |
| Cambiar rol de Admin/Operator/Viewer | Allow + MFA | No | No | No |
| Transferir o remover Owner | Allow + MFA | No | No | No |
| Remover miembros no Owner | Allow + MFA | Allow + MFA | No | No |
| Ver miembros | Allow | Allow | Allow | Allow |

Un Owner administra la propiedad y las politicas de la organizacion. Un Admin administra miembros, dispositivos, credenciales y configuracion operativa, pero no puede transferir propiedad, eliminar la organizacion, cambiar su propio rol ni gestionar Owners.

## Dispositivos y credenciales

| Accion | Owner | Admin | Operator | Viewer | Device |
| --- | --- | --- | --- | --- | --- |
| Listar o consultar dispositivos | Allow | Allow | Allow | Allow | No |
| Registrar, editar o desactivar | Allow + MFA | Allow + MFA | No | No | No |
| Activar dispositivo | Allow + MFA | Allow + MFA | No | No | Token unico |
| Rotar o revocar credencial | Allow + MFA | Allow + MFA | No | No | No |
| Ver secreto o clave privada | No | No | No | No | No |
| Publicar telemetria propia | No | No | No | No | Allow MQTT |
| Consumir comandos propios | No | No | No | No | Allow MQTT |

Las respuestas nunca devuelven secretos, tokens de activacion usados ni claves privadas. La activacion entrega material sensible una sola vez y su acceso queda auditado.

## Telemetria, realtime y exportacion

| Accion | Owner | Admin | Operator | Viewer |
| --- | --- | --- | --- | --- |
| Consultar snapshot e historico | Allow | Allow | Allow | Allow |
| Suscribirse a realtime | Allow | Allow | Allow | Allow |
| Exportar CSV | Allow + MFA | Allow + MFA | Allow | No |
| Configurar retencion | Allow + MFA | No | No | No |
| Solicitar eliminacion total de datos del tenant | Allow + MFA + confirmacion `DELETE` | No | No | No |

Las consultas, suscripciones y exportaciones se limitan a los dispositivos de la organizacion. Exportar aplica rango maximo, rate limit, escape de formulas CSV y auditoria.

La eliminacion total se ejecuta como un trabajo durable y reintentable. Solo el Owner puede solicitarla con confirmacion explicita; el solicitante puede consultar su trabajo con el mismo `organizationId`. El trabajo elimina datos operativos y membresias de ese tenant en una transaccion, conserva el registro de auditoria y marca la organizacion eliminada para impedir nueva ingesta o acceso por API.

## Comandos y alertas

| Accion | Owner | Admin | Operator | Viewer |
| --- | --- | --- | --- | --- |
| Consultar catalogo y estados | Allow | Allow | Allow | Allow |
| Solicitar comando no critico | Allow + MFA | Allow + MFA | Allow | No |
| Solicitar comando critico | Allow + MFA + confirmacion | Allow + MFA + confirmacion | No | No |
| Cancelar comando pendiente | Allow | Allow | Own | No |
| Crear o editar regla de alerta | Allow + MFA | Allow + MFA | No | No |
| Reconocer alerta | Allow | Allow | Allow | No |
| Resolver alerta | Allow | Allow | Allow | No |
| Silenciar alerta | Allow | Allow | Own | No |
| Ver auditoria de comando o alerta | Allow | Allow | Allow | Read-only |

Un comando solo puede ejecutarse si la capacidad esta registrada para el dispositivo. Un ACK no cambia la autorizacion original ni da privilegios al dispositivo.

## Auditoria y administracion de seguridad

| Accion | Owner | Admin | Operator | Viewer |
| --- | --- | --- | --- | --- |
| Consultar auditoria de la organizacion | Allow | Allow | Read-only limitado | No |
| Configurar politicas de seguridad | Allow + MFA | No | No | No |
| Configurar integracion de identidad | Allow + MFA | No | No | No |
| Gestionar claves, CA o broker | Fuera de la app | Fuera de la app | No | No |

Los operadores de infraestructura usan acceso separado de la aplicacion, con minimo privilegio, trazabilidad y procedimientos operativos.

## Politica de evaluacion

Cada endpoint y canal debe evaluar, en este orden:

1. Identidad autenticada y sesion valida.
2. Membresia activa en la organizacion.
3. Rol permitido para la accion.
4. Propiedad o pertenencia del recurso a la organizacion.
5. Condiciones adicionales: MFA, capacidad del dispositivo, rate limit, estado del recurso y confirmacion de comando critico.
6. Auditoria del resultado, tanto permitido como denegado para acciones sensibles.

## Casos negativos obligatorios

- Viewer intenta enviar un comando, exportar o modificar una regla.
- Operator intenta administrar miembros, credenciales o configuracion global.
- Admin intenta elevar su rol o modificar/remover un Owner.
- Usuario de otra organizacion consulta, exporta, se suscribe o modifica un dispositivo ajeno.
- Device intenta publicar en otro topico, consumir un comando ajeno o acceder a HTTP administrativo.
- Token de activacion vencido o reutilizado intenta crear una identidad.

## Parametros de implementacion pendientes

- El catalogo de comandos criticos se aplicara por capacidad de dispositivo; todos requieren confirmacion adicional.
- La auditoria registra actor, accion, recurso, fecha, sesion, resultado y `organizationId`.
- Los periodos de reautenticacion MFA y la politica de cuentas externas se definiran al integrar OIDC, sin alterar el principio deny-by-default.
