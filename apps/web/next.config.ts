import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const apiUrl = process.env.API_URL ?? "http://localhost:4000";
    const apiOrigin = new URL(apiUrl).origin;
    const websocketOrigin = apiOrigin.replace(/^http/, "ws");
    const scriptSource =
      process.env.NODE_ENV === "production"
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "img-src 'self' data:",
          "font-src 'self'",
          `connect-src 'self' ${apiOrigin} ${websocketOrigin}`,
          scriptSource,
          "style-src 'self' 'unsafe-inline'",
        ].join("; "),
      },
    ];

    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      });
    }

    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
