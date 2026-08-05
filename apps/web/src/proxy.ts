import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const sessionCookie = "smart-house-access-token";

export function proxy(request: NextRequest) {
  if (!request.cookies.has(sessionCookie)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
