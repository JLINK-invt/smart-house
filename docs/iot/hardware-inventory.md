# Inventario de hardware, protocolos y payloads

## Estado

La primera flota usara dispositivos de la familia Tuya: sensores de temperatura y humedad, relays y focos conectados por Wi-Fi. El spike usa ademas un gateway y un medidor de energia simulados por casa. Aun faltan modelos exactos, firmware y capturas de trafico para completar la validacion tecnica.

No debe habilitarse un dispositivo en produccion hasta completar una fila con evidencia verificable.

## Matriz de dispositivos

| Campo | Requerido | Ejemplo esperado |
| --- | --- | --- |
| Fabricante y modelo | Si | `Acme TH-100` |
| Version de hardware y firmware | Si | `rev-2 / 1.4.0` |
| Organizacion y entorno | Si | `pilot-acme / staging` |
| Conectividad | Si | Wi-Fi, Ethernet, LTE o gateway |
| Protocolo y version | Si | MQTT 5.0 sobre TLS |
| Soporte criptografico | Si | TLS, mTLS, almacen seguro, algoritmo y CA admitida |
| Identidad | Si | Certificado unico o credencial rotatoria por dispositivo |
| Capacidades | Si | Metricas y comandos compatibles |
| Frecuencia maxima | Si | Mensajes por segundo y comportamiento de rafaga |
| Tamano maximo | Si | Bytes del payload y atributos MQTT |
| Topicos | Si | Telemetria publicada y comandos consumidos |
| Muestra real | Si | Payload valido, invalido y duplicado capturados |
| Restricciones | Si | Bateria, red intermitente, reloj, memoria o compatibilidad |

## Alcance confirmado de la primera flota

| Categoria | Conexion | Telemetria o accion inicial |
| --- | --- | --- |
| Sensor Tuya de temperatura y humedad | Wi-Fi | Temperatura, humedad y bateria cada 60 segundos. |
| Relay Tuya | Wi-Fi | Estado de rele; encender/apagar, reiniciar y cambiar intervalo de reporte. |
| Foco Tuya | Wi-Fi | Estado de encendido; encender/apagar, reiniciar y cambiar intervalo de reporte. |
| Gateway simulado | Wi-Fi | Heartbeat y estado cada 60 segundos. |
| Medidor de energia simulado | Wi-Fi | Consumo de energia cada 10 segundos. |

## Perfil aprobado para el spike

- 10 casas simuladas.
- Por casa: 1 gateway, 1 medidor de energia, 4 sensores de temperatura y 4 relays.
- Total: 100 dispositivos simulados y 190 mensajes por minuto.
- Los perfiles de bajo consumo y alta frecuencia se conservan para pruebas posteriores de eficiencia y rendimiento.

## Baseline de protocolo

| Decision | Valor inicial | Validacion pendiente |
| --- | --- | --- |
| Transporte | MQTT sobre TLS | Confirmar version MQTT y bibliotecas por modelo. |
| Entrega | QoS 1 para telemetria y comandos confirmables | Medir duplicados, reconexion y almacenamiento del cliente. |
| Identidad | Una identidad unica por dispositivo | Confirmar soporte de mTLS y almacenamiento de claves. |
| Autorizacion | ACL minima por topico y tenant | Confirmar convencion de topicos del broker elegido. |
| Idempotencia | `messageId` unico por mensaje | Confirmar fuente y persistencia del identificador en firmware. |
| Tiempo | `occurredAt` del dispositivo y `receivedAt` del worker | Medir deriva de reloj y mecanismo de sincronizacion. |
| Tamano | Limite estricto configurado por tipo | Definir con capturas de payload y margen de evolucion. |

## Contrato preliminar de topicos

La convencion se validara contra el broker y el firmware antes de implementarla:

```text
organizations/{organizationId}/devices/{deviceId}/telemetry
organizations/{organizationId}/devices/{deviceId}/commands
organizations/{organizationId}/devices/{deviceId}/command-acks
```

Un dispositivo solo puede publicar telemetria y ACK en sus propios topicos, y solo consumir su topico de comandos. La identidad del certificado o credencial debe enlazarse al `organizationId` y `deviceId` autorizados; ambos valores recibidos en el payload se verifican y nunca se aceptan por confianza.

## Capturas requeridas por modelo

1. Conexion exitosa y fallida con la configuracion TLS real.
2. Telemetria valida representativa de cada metrica.
3. Telemetria invalida: esquema, tipo, unidad, timestamp y tamano.
4. Reintento QoS 1 con el mismo `messageId`.
5. Rafaga maxima esperada durante al menos un minuto.
6. Reconexiones, perdida de red y comportamiento de sesion.
7. ACK exitoso, ACK fallido y comando vencido.

## Riesgos conocidos

- Hardware sin mTLS requerira una excepcion de seguridad documentada, credencial unica rotatoria y aislamiento adicional mediante gateway.
- Relojes no sincronizados pueden invalidar reglas de duracion y graficas; se conservara `receivedAt` como fuente de ordenacion confiable.
- Firmwares sin almacenamiento persistente de `messageId` pueden producir duplicados; la deduplicacion del worker sera obligatoria.
- Payloads variables o no versionados bloquean una ingesta segura; cada tipo necesita un esquema versionado antes de conectarse.

## Datos pendientes del equipo de hardware

- Modelos Tuya exactos, revisiones y firmware de la flota inicial.
- Muestras reales de payload y frecuencia normal/de rafaga.
- Broker disponible, version MQTT y configuracion TLS.
- Capacidades criptograficas y mecanismo de provisionamiento por modelo.
- Catalogo final de metricas, unidades y comandos permitidos por modelo.

La tarea se completa al revisar esta matriz con las muestras reales y adjuntar evidencia para cada modelo piloto.
