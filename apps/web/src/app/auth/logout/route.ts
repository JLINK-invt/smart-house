import { NextRequest, NextResponse } from "next/server";
import { accessTokenCookie } from "@/lib/auth";
import { getKeycloakConfig } from "@/lib/config";

export function GET(request: NextRequest) {
  const { issuer, clientId } = getKeycloakConfig();
  const logoutUrl = new URL(`${issuer}/protocol/openid-connect/logout`);
  logoutUrl.search = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: new URL("/login", request.url).toString(),
  }).toString();
  const response = NextResponse.redirect(logoutUrl);
  response.cookies.delete(accessTokenCookie);
  return response;
}
