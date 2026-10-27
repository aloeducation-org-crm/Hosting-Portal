import type { NextConfig } from "next";
import path from "node:path";

// Works whether Next loads this file as CJS (__dirname defined) or ESM
// (the typeof guard prevents a ReferenceError).
const appRoot = typeof __dirname !== "undefined" ? __dirname : process.cwd();

const nextConfig: NextConfig = {
  output: "standalone",

  // ── Pin the tracing root to THIS directory ────────────────────────────────
  // Without this, Next.js *infers* the workspace root by walking up looking for
  // lockfiles. This repo has more than one, so a build started in a
  // subdirectory inferred the root as the repository root and emitted
  //   .next/standalone/<subdir>/server.js
  // instead of
  //   .next/standalone/server.js
  // which made `npm start` (`node .next/standalone/server.js`) crash-loop with
  // MODULE_NOT_FOUND. Pinning it makes the output location deterministic no
  // matter which directory the build is invoked from.
  outputFileTracingRoot: appRoot,

  // Note: `src/lib/helpers.ts` composes helper paths at runtime, so Turbopack
  // prints "Dynamic filesystem access causes tracing of the whole project" and
  // copies the full checkout into .next/standalone (~174 MB, of which ~143 MB is
  // traced node_modules). outputFileTracingExclude does not suppress that under
  // Turbopack, so it is deliberately not set here — a setting that looks like it
  // works is worse than none. The deploy workflow prunes old releases instead.

  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ["*.e2b.app"],
  async headers() {
    const baseHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      ...(process.env.ALLOW_PREVIEW_EMBED === "1"
        ? []
        : [{ key: "X-Frame-Options", value: "SAMEORIGIN" }]),
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    ];
    return [
      {
        source: "/:path*",
        headers: baseHeaders,
      },
    ];
  },
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
