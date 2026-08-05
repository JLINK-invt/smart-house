const defaultApiUrl = "http://localhost:4000";
const defaultKeycloakIssuer = "http://localhost:8080/realms/smart-house";

export function getApiUrl(): string {
  const value = process.env.API_URL ?? defaultApiUrl;

  try {
    return new URL(value).origin;
  } catch {
    throw new Error("API_URL must be an absolute URL.");
  }
}

export function getKeycloakConfig() {
  const issuer = process.env.KEYCLOAK_ISSUER ?? defaultKeycloakIssuer;
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "smart-house-web";
  const redirectUri =
    process.env.KEYCLOAK_REDIRECT_URI ?? "http://localhost:3000/auth/callback";

  return { issuer: new URL(issuer).origin + new URL(issuer).pathname.replace(/\/$/, ""), clientId, redirectUri };
}
