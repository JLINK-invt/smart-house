# ADR 0006: Realtime mediante WebSocket autorizado

- Estado: Accepted
- Contexto: el panel necesita reflejar telemetria, comandos y alertas sin exponer eventos de otro tenant.
- Decision: la API expone un WebSocket Gateway autenticado. La autorizacion se verifica al conectar y al suscribirse a canales de organizacion o dispositivo. El cliente se recupera mediante snapshot HTTP y backoff.
- Consecuencias: se debe definir adaptador Redis al escalar replicas y probar reconexion, orden e aislamiento. HTTP sigue siendo la fuente de snapshot.
- Alternativas rechazadas: polling agresivo, sockets sin autorizacion por canal y entrega directa desde el worker al navegador.
