# ADR 0003: Broker MQTT e identidad de dispositivos

- Estado: Accepted
- Contexto: los dispositivos requieren entrega QoS 1, aislamiento por tenant y credenciales revocables.
- Decision: operar MQTT sobre TLS con identidad unica por dispositivo, ACL de minimo privilegio y QoS 1 para telemetria y comandos confirmables. mTLS es el objetivo por defecto; hardware que no lo soporte requiere una excepcion documentada.
- Consecuencias: el broker se selecciona por soporte de mTLS, ACL, sesiones durables y observabilidad. El firmware debe conservar identificadores para idempotencia cuando sea viable.
- Alternativas rechazadas: secreto compartido de flota, topicos globales y telemetria sin identidad verificable.
