# ADR 0006: Realtime mediante WebSocket autorizado

- Estado: Accepted
- Contexto: el panel necesita reflejar telemetria, comandos y alertas sin exponer eventos de otro tenant.
- Decision: la API expone un WebSocket Gateway autenticado. La autorizacion se verifica al conectar y al suscribirse a canales de organizacion o dispositivo. Cada replica se suscribe al PubSub Redis del worker y emite el evento solo a sus miembros locales de las salas Socket.IO; no se usa adaptador Redis de Socket.IO porque el PubSub ya entrega cada evento a todas las replicas. El cliente se recupera mediante snapshot HTTP y backoff.
- Consecuencias: se debe probar reconexion, orden e aislamiento. HTTP sigue siendo la fuente de snapshot.
- Alternativas rechazadas: polling agresivo, sockets sin autorizacion por canal y entrega directa desde el worker al navegador.
