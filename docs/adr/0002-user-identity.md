# ADR 0002: Identidad de usuarios mediante OIDC

- Estado: Accepted
- Contexto: la plataforma necesita registro, sesion, recuperacion, MFA y control de privilegios sin construir un proveedor de identidad propio.
- Decision: usar Keycloak como proveedor OIDC/OAuth 2.1 con Authorization Code y PKCE. La API valida identidad y membresia; la web no es autoridad de permisos. Owner y Admin requieren MFA.
- Consecuencias: se reducen secretos y logica de autenticacion local; Keycloak administra registro, recuperacion, MFA y sesiones. El entorno local importa el realm `smart-house`; produccion requiere una instancia administrada, rotacion y operacion documentadas.
- Alternativas rechazadas: credenciales propias en la API y autenticacion solo en la web.
