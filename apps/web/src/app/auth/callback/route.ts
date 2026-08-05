import { NextRequest, NextResponse } from "next/server";
import { accessTokenCookie, oidcStateCookie, pkceVerifierCookie } from "@/lib/auth";
import { getKeycloakConfig } from "@/lib/config";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const verifier = request.cookies.get(pkceVerifierCookie)?.value;
  if (!code || !verifier || state !== request.cookies.get(oidcStateCookie)?.value) {
    return NextResponse.redirect(new URL("/login?error=invalid-callback", request.url));
  }

  const { issuer, clientId, redirectUri } = getKeycloakConfig();
  const tokenResponse = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier }),
    cache: "no-store",
  });
  const payload = (await tokenResponse.json()) as { access_token?: string; expires_in?: number };
  if (!tokenResponse.ok || !payload.access_token) {
    return NextResponse.redirect(new URL("/login?error=token-exchange", request.url));
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.cookies.set(accessTokenCookie, payload.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: payload.expires_in ?? 300,
    path: "/",
  });
  response.cookies.delete(pkceVerifierCookie);
  response.cookies.delete(oidcStateCookie);
  return response;
}
