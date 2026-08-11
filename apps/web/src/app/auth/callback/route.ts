import { NextRequest, NextResponse } from "next/server";
import {
  accessTokenCookie,
  idTokenCookie,
  oidcStateCookie,
  pkceVerifierCookie,
} from "@/lib/auth";
import { getKeycloakConfig } from "@/lib/config";

type TokenPayload = {
  access_token?: string;
  id_token?: string;
  expires_in?: number;
};

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const verifier = request.cookies.get(pkceVerifierCookie)?.value;
  if (!code || !verifier || state !== request.cookies.get(oidcStateCookie)?.value) {
    return loginError(request, "invalid-callback");
  }

  const { issuer, clientId, redirectUri } = getKeycloakConfig();
  let payload: TokenPayload;
  try {
    const tokenResponse = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier }),
      cache: "no-store",
    });
    payload = (await tokenResponse.json()) as TokenPayload;
    if (!tokenResponse.ok || !payload.access_token || !payload.id_token) {
      return loginError(request, "token-exchange");
    }
  } catch {
    return loginError(request, "token-exchange");
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: payload.expires_in ?? 300,
    path: "/",
  };
  response.cookies.set(accessTokenCookie, payload.access_token, cookie);
  response.cookies.set(idTokenCookie, payload.id_token, cookie);
  response.cookies.delete(pkceVerifierCookie);
  response.cookies.delete(oidcStateCookie);
  return response;
}

function loginError(request: NextRequest, error: string) {
  const response = NextResponse.redirect(new URL(`/login?error=${error}`, request.url));
  response.cookies.delete(pkceVerifierCookie);
  response.cookies.delete(oidcStateCookie);
  return response;
}
