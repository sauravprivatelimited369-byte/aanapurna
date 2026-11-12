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
};

export default nextConfig;
