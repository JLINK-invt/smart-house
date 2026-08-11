# Cadena de suministro y contenedores

## Controles en CI

El workflow `Supply Chain` se ejecuta en pull requests y en las ramas protegidas.
Genera un SBOM CycloneDX con Syft, lo conserva como artefacto de CI y ejecuta
Trivy sobre dependencias y ficheros del repositorio. El job falla ante
vulnerabilidades `HIGH` o `CRITICAL` corregibles.

`pnpm check:supply-chain` es la validacion reproducible local de las reglas de
contenedores: toda imagen de Compose debe tener digest SHA-256, no puede usar
`latest` y los puertos publicados deben limitarse a loopback. Ejecutar antes de
abrir un pull request:

```bash
pnpm check:supply-chain
docker compose -f infra/local/docker-compose.yml config --quiet
docker compose -f simulador/docker-compose.yml config --quiet
```

Las acciones de GitHub deben actualizarse a revisiones SHA completas. La
referencia de `checkout` queda fijada de ese modo; al actualizar el resto de
acciones se debe sustituir su tag por el SHA publicado y conservar el comentario
de version para revision humana.

## Imagenes locales

Los servicios de `infra/local` y el simulador estan fijados por version y digest
multi-arquitectura. Para actualizar una imagen se debe revisar el changelog y
sus vulnerabilidades, obtener el digest del manifiesto de la version elegida y
actualizar version y digest en todos los Compose que la usan. Nunca usar
`latest`, ni un digest de una arquitectura individual.

Estos Compose son solo para desarrollo: no existe Dockerfile ni imagen de
aplicacion de produccion en este repositorio. Cuando se incorporen, el pipeline
de release debe construir desde un commit limpio, emitir SBOM de la imagen y
publicar por digest.

## Procedencia y firmas

Antes de promover una imagen propia, exigir una procedencia asociada al digest y
verificarla en un runner limpio. Para imagenes publicadas en GHCR por GitHub
Actions:

```bash
gh attestation verify oci://ghcr.io/ORGANIZACION/IMAGEN@sha256:DIGEST \
  --owner ORGANIZACION
```

La publicacion debe usar identidad OIDC de GitHub Actions y permisos minimos
(`attestations: write`, `id-token: write`, `packages: write` solo en el job de
release). No se debe aceptar una etiqueta como evidencia de procedencia: la
promocion y la verificacion siempre usan el digest. Para imagenes de terceros,
registrar proveedor, digest, fecha de revision y metodo de firma o procedencia
en el cambio que las introduce.

## Secretos

Las contrasenas presentes como valores por defecto de Compose son exclusivas de
desarrollo local y pueden sustituirse con `POSTGRES_PASSWORD`,
`GRAFANA_ADMIN_PASSWORD` y `KEYCLOAK_ADMIN_PASSWORD`. Los puertos locales se
enlazan a `127.0.0.1`; Redis y Mailpit no deben exponerse fuera del equipo.

Produccion debe obtener secretos en tiempo de ejecucion desde un vault o gestor
equivalente mediante identidad de workload, no desde imagenes, argumentos de
build, archivos `.env` versionados ni logs. El despliegue debe inyectar solo el
secreto necesario para cada servicio, rotarlo en el vault y reiniciar o recargar
el workload de forma controlada. Los certificados MQTT locales bajo
`infra/local/certs/` siguen ignorados por Git y no deben reutilizarse fuera de
desarrollo.
