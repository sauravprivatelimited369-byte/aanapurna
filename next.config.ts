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
      // Report-only first: the application has no nonce pipeline yet, so an
      // enforcing policy would break Next.js inline bootstrap scripts. The
      // report-only policy keeps the intent visible and is a prerequisite for
      // switching to enforcement after browser testing.
      {
        key: "Content-Security-Policy-Report-Only",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "object-src 'none'",
        ].join("; "),
      },
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
