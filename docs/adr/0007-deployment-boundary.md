# ADR 0007: Despliegue independiente y configuracion por entorno

- Estado: Accepted
- Contexto: web, API y worker pueden tener ritmos y necesidades de escalado distintos, pero el MVP necesita bajo costo operativo.
- Decision: conservar un monorepo pnpm y artefactos desplegables por aplicacion. La configuracion se valida al arrancar, separa valores publicos de secretos y nunca expone secretos al bundle web o logs.
- Consecuencias: CI debe construir, probar y promover el mismo artefacto por entorno; un despliegue local reproducible incluira broker, base y Redis cuando se implementen.
- Alternativas rechazadas: un unico contenedor para todo, secretos en archivos versionados y Kubernetes anticipado.
