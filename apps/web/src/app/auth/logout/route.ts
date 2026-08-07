import { NextRequest, NextResponse } from "next/server";
import {
  accessTokenCookie,
  idTokenCookie,
  oidcStateCookie,
  pkceVerifierCookie,
} from "@/lib/auth";
import { getKeycloakConfig } from "@/lib/config";

export function GET(request: NextRequest) {
  const { issuer, clientId, redirectUri } = getKeycloakConfig();
  const sessionExpired = request.nextUrl.searchParams.get("error") === "session-expired";
  const logoutUrl = new URL(`${issuer}/protocol/openid-connect/logout`);
  const parameters = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: new URL(
      sessionExpired ? "/login?error=session-expired" : "/login",
      redirectUri,
    ).toString(),
  });
  const idToken = request.cookies.get(idTokenCookie)?.value;
  if (idToken) parameters.set("id_token_hint", idToken);
  logoutUrl.search = parameters.toString();
  const response = NextResponse.redirect(logoutUrl);
  response.cookies.delete(accessTokenCookie);
  response.cookies.delete(idTokenCookie);
  response.cookies.delete(pkceVerifierCookie);
  response.cookies.delete(oidcStateCookie);
  return response;
}
