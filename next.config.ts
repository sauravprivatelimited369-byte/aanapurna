import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ["localhost", "127.0.0.1", "*.e2b.app"],
  logging: {
    incomingRequests: {
      // Better Auth verification/reset actions can carry one-time credentials in the URL.
      ignore: [/^\/api\/auth\//],
    },
  },
  serverExternalPackages: ["pg", "graphile-worker", "nodemailer"],
  // These headers used to exist only in the Caddy reverse proxy, so the hosted
  // deployment (Vercel) served responses without them. Set them here as well:
  // the proxy may override, never remove, and both paths now agree.
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      // The enforcing Content-Security-Policy is set in `src/middleware.ts`,
      // because it needs a fresh per-request nonce. It is deliberately not
      // duplicated here: a static header would either lack the nonce or carry a
      // stale one.
    ];
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Responses that carry a one-time credential in the URL must never be
      // cached by a shared proxy.
      { source: "/api/auth/(.*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
