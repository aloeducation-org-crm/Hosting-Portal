import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  allowedDevOrigins: ["*.e2b.app"],
  typescript: {
    ignoreBuildErrors: false,
  },
  serverExternalPackages: ["pino", "pino-pretty", "bcryptjs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
