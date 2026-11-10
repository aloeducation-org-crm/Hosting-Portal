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
  // The immutable no-loss archive is never imported; keep it out of the
  // standalone bundle so preserving history does not bloat production output.
  outputFileTracingExcludes: {
    "*": ["./archive/**"],
  },

  // Runtime-composed filesystem paths are annotated with /*turbopackIgnore: true*/
  // at their call sites (helpers, deploy engine, storage, cloud foundation).
  // That keeps Turbopack from tracing the whole checkout into .next/standalone.
  // The production build is verified to emit zero tracing warnings; do not
  // remove those annotations when editing the affected modules.

  // The public storefront (plans, prices, domain sales) is retired: the site now
  // showcases the projects we run. The pages are kept in the tree so they can be
  // re-enabled, but every storefront URL redirects to the project that actually
  // runs that infrastructure.
  async redirects() {
    const project = "/projects/hosting-portal";
    return [
      { source: "/pricing", destination: "/", permanent: false },
      { source: "/hosting", destination: project, permanent: false },
      { source: "/hosting/:path*", destination: project, permanent: false },
      { source: "/domains", destination: project, permanent: false },
      { source: "/email", destination: project, permanent: false },
      { source: "/ssl", destination: project, permanent: false },
    ];
  },

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
      // Enforced directives that cannot break Next.js hydration: no base-tag
      // hijacking, no cross-origin form posts, no clickjacking, no plugins.
      { key: "Content-Security-Policy", value: "base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'" },
      // A broader policy is rolled out in report-only mode so operators can see
      // violations before enforcing script/style/connect restrictions.
      {
        key: "Content-Security-Policy-Report-Only",
        value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https: ws: wss:; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
      },
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
