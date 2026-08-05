import { createHash, randomBytes } from "node:crypto";

export const accessTokenCookie = "smart-house-access-token";
export const pkceVerifierCookie = "smart-house-pkce-verifier";
export const oidcStateCookie = "smart-house-oidc-state";

export function createPkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(24).toString("base64url");
}
