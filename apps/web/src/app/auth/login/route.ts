import { NextResponse } from "next/server";
import { createPkcePair, createState, oidcStateCookie, pkceVerifierCookie } from "@/lib/auth";
import { getKeycloakConfig } from "@/lib/config";

export function GET(request: Request) {
  const { issuer, clientId, redirectUri } = getKeycloakConfig();
  const { verifier, challenge } = createPkcePair();
  const state = createState();
  const authorizationUrl = new URL(`${issuer}/protocol/openid-connect/auth`);
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const response = NextResponse.redirect(authorizationUrl);
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    maxAge: 600,
    path: "/",
  };
  response.cookies.set(pkceVerifierCookie, verifier, cookie);
  response.cookies.set(oidcStateCookie, state, cookie);
  return response;
}
