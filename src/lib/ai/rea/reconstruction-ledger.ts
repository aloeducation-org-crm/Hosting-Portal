/**
 * REA-Guided Source Evidence & Feature-Reconstruction Ledger
 *
 * Implements the evidence discipline from `morluto/rea` (`AGENTS.md` and
 * `.agents/skills/reverse-engineer-anything/SKILL.md` v59):
 *   1. For a complete open-source repository (`appwrite/appwrite`), use direct
 *      pinned-commit source inspection rather than native binary decompilation
 *      or claiming runtime execution.
 *   2. Distinguish `observation` (directly inspected upstream source/config),
 *      `derivation` (structural mapping to first-party contracts), `inference`
 *      and `unknown` (runtime/container behavior not executed here).
 *   3. Cite stable Evidence IDs, exact repository commits, file paths, and
 *      license identifiers (`BSD-3-Clause` for Appwrite, `MIT` for REA).
 *   4. Separate first-party capabilities implemented in ALO Hosting Portal
 *      (`AVAILABLE`) from capabilities requiring an external isolated runtime
 *      (`REQUIRES_SETUP`) or deferred upstream container stacks (`DEFERRED`).
 *
 * Pure data + validation only: no network calls, no subprocesses, no authority.
 */

import { z } from "zod";

export const ReaEvidenceKindSchema = z.enum([
  "observation",
  "derivation",
  "inference",
  "unknown",
]);
export type ReaEvidenceKind = z.infer<typeof ReaEvidenceKindSchema>;

export const ReconstructionOperationalStateSchema = z.enum([
  "AVAILABLE",
  "CONFIGURED",
  "REQUIRES_SETUP",
  "REQUIRES_APPROVAL",
  "DEFERRED",
]);
export type ReconstructionOperationalState = z.infer<typeof ReconstructionOperationalStateSchema>;

export const ReaSourceEvidenceSchema = z
  .object({
    evidenceId: z.string().regex(/^ev-[a-z0-9-]+$/),
    kind: ReaEvidenceKindSchema,
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    pinnedCommit: z.string().regex(/^[a-f0-9]{40}$/),
    license: z.string().min(2).max(64),
    sourcePath: z.string().min(1).max(240),
    summary: z.string().min(12).max(600),
    limitations: z.string().min(8).max(400),
  })
  .strict();

export type ReaSourceEvidence = z.infer<typeof ReaSourceEvidenceSchema>;

export const ReconstructedCapabilitySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    appwriteService: z.string().min(2).max(80),
    title: z.string().min(4).max(120),
    evidenceIds: z.array(z.string().regex(/^ev-[a-z0-9-]+$/)).min(1),
    portalSurface: z.string().min(1).max(200),
    operationalState: ReconstructionOperationalStateSchema,
    executableRuntimeAttached: z.literal(false),
    whatWorksNow: z.string().min(12).max(600),
    designDifference: z.string().min(12).max(600),
    remainingGate: z.string().min(8).max(400),
  })
  .strict();

export type ReconstructedCapability = z.infer<typeof ReconstructedCapabilitySchema>;

export const UPSTREAM_INSPECTION_BASELINES = Object.freeze({
  appwrite: {
    repository: "appwrite/appwrite",
    canonicalUrl: "https://github.com/appwrite/appwrite",
    pinnedCommit: "da8e595a804834ffcf63b83140ff09b29ce77140",
    selfHostedImageReference: "appwrite/appwrite:2.6.2",
    license: "BSD-3-Clause",
  },
  rea: {
    repository: "morluto/rea",
    canonicalUrl: "https://github.com/morluto/rea",
    pinnedCommit: "26c3e9e4134971c79e822bbcb16fb42bb7dd8e8d",
    adapterProtocolBaselineCommit: "d9e01e5af2dda46f9c7adb6cfde82805845651e9",
    packageBaseline: "rea-agents@6.8.0",
    skillVersion: "59",
    license: "MIT",
  },
} as const);

export const APPWRITE_REA_EVIDENCE_LEDGER: readonly ReaSourceEvidence[] = Object.freeze([
  {
    evidenceId: "ev-rea-skill-source-route",
    kind: "observation",
    repository: "morluto/rea",
    pinnedCommit: UPSTREAM_INSPECTION_BASELINES.rea.pinnedCommit,
    license: "MIT",
    sourcePath: ".agents/skills/reverse-engineer-anything/SKILL.md",
    summary:
      "REA SKILL.md v59 instructs agents to analyze complete source repositories with normal repository tools rather than binary/Ghidra providers, cite Evidence IDs, separate observations from design choices, and preserve unknowns.",
    limitations:
      "Static source reading only; upstream rea-agents CLI/MCP was not installed or executed in the portal runtime.",
  },
  {
    evidenceId: "ev-rea-agents-provenance",
    kind: "observation",
    repository: "morluto/rea",
    pinnedCommit: UPSTREAM_INSPECTION_BASELINES.rea.pinnedCommit,
    license: "MIT",
    sourcePath: "AGENTS.md",
    summary:
      "REA AGENTS.md requires distinguishing observations, derivations, inferences, and unknowns, redacting credentials, and refusing capability integration while execution or isolation boundaries remain unresolved.",
    limitations:
      "Applies as architectural methodology; native Hopper/Ghidra/IDA/LLDB bridges remain disabled on this host.",
  },
  {
    evidenceId: "ev-appwrite-architecture",
    kind: "observation",
    repository: "appwrite/appwrite",
    pinnedCommit: UPSTREAM_INSPECTION_BASELINES.appwrite.pinnedCommit,
    license: "BSD-3-Clause",
    sourcePath: "AGENTS.md",
    summary:
      "Appwrite is a hybrid monolithic-microservice Backend-as-a-Service built on PHP 8.5, Swoole 6, Utopia PHP, PostgreSQL/MongoDB, Redis 7, Traefik 3.6, background workers, and an Open Runtimes HTTP executor (`src/Executor/`).",
    limitations:
      "Inspected from source and docker-compose.yml; the multi-container PHP/Swoole/Traefik stack was not started.",
  },
  {
    evidenceId: "ev-appwrite-console-profile",
    kind: "observation",
    repository: "appwrite/appwrite",
    pinnedCommit: UPSTREAM_INSPECTION_BASELINES.appwrite.pinnedCommit,
    license: "BSD-3-Clause",
    sourcePath: "apps/console/README.md",
    summary:
      "Appwrite Console (`apps/console`, React 19 + Tailwind CSS 4 + shadcn/ui) organizes developer workflows by Organization -> Project covering Auth, Databases, Storage, Functions, Sites, Messaging, and Project Settings.",
    limitations:
      "UI patterns reconstructed natively in Next.js App Router; zero proprietary branding or assets copied.",
  },
  {
    evidenceId: "ev-appwrite-services-catalog",
    kind: "observation",
    repository: "appwrite/appwrite",
    pinnedCommit: UPSTREAM_INSPECTION_BASELINES.appwrite.pinnedCommit,
    license: "BSD-3-Clause",
    sourcePath: "app/config/services.php",
    summary:
      "Declares unified project services across `account`, `users`, `teams`, `databases`, `tablesdb`, `storage`, `functions`, `sites`, `messaging`, `vcs`, `webhooks`, `proxy`, `monitors`, `alerts`, and `advisor`.",
    limitations:
      "GraphQL, Realtime WebSocket fan-out, and Avatars/Locale microservices are catalogued as future candidates rather than emulated.",
  },
  {
    evidenceId: "ev-appwrite-project-scopes",
    kind: "observation",
    repository: "appwrite/appwrite",
    pinnedCommit: UPSTREAM_INSPECTION_BASELINES.appwrite.pinnedCommit,
    license: "BSD-3-Clause",
    sourcePath: "app/config/scopes/project.php",
    summary:
      "Models granular per-project API key permissions (`project.read/write`, `sites.*`, `databases.*`, `storage.*`, `functions.*`, `users.*`, `messaging.*`, `webhooks.*`, `platforms.*`, `health.read`) separate from browser sessions.",
    limitations:
      "Reconstructed with SHA-256 hashed secrets and constant-time comparison over SQLite (`cloud_project_keys`).",
  },
  {
    evidenceId: "ev-appwrite-sites-frameworks",
    kind: "observation",
    repository: "appwrite/appwrite",
    pinnedCommit: UPSTREAM_INSPECTION_BASELINES.appwrite.pinnedCommit,
    license: "BSD-3-Clause",
    sourcePath: "app/config/frameworks.php",
    summary:
      "Defines Appwrite Sites framework adapters (`nextjs`, `react`, `angular`, `analog`, `vue`, `nuxt`, `sveltekit`, `astro`, etc.) with `ssr` and `static` build commands, install commands, output directories, and SPA fallback files.",
    limitations:
      "Framework presets configure project metadata and link to `/sites` and `/deployments`; isolated container builds still run through the portal's existing deployment worker.",
  },
  {
    evidenceId: "ev-appwrite-functions-module",
    kind: "observation",
    repository: "appwrite/appwrite",
    pinnedCommit: UPSTREAM_INSPECTION_BASELINES.appwrite.pinnedCommit,
    license: "BSD-3-Clause",
    sourcePath: "src/Appwrite/Platform/Modules/Functions/Module.php",
    summary:
      "Models serverless functions with pinned runtimes, entrypoints, build commands, event triggers, cron schedules, timeouts, variables, and isolated Open Runtimes execution.",
    limitations:
      "Function definitions persist durably in `cloud_project_functions`, while `executionState` remains `REQUIRES_SETUP` until an isolated container executor is attached.",
  },
  {
    evidenceId: "ev-appwrite-advisor-mcp",
    kind: "derivation",
    repository: "appwrite/appwrite",
    pinnedCommit: UPSTREAM_INSPECTION_BASELINES.appwrite.pinnedCommit,
    license: "BSD-3-Clause",
    sourcePath: "README.md",
    summary:
      "Combines Appwrite's `advisor` posture service (`app/config/services.php`) and agent-first MCP/SDK onboarding (`README.md#agents`) into deterministic project posture checks and secret-free SDK/MCP connection snippets.",
    limitations:
      "Does not connect to `https://mcp.appwrite.io/` or external OAuth endpoints; snippets target first-party `/api/cloud/v1/health`.",
  },
  {
    evidenceId: "ev-appwrite-runtime-unknown",
    kind: "unknown",
    repository: "appwrite/appwrite",
    pinnedCommit: UPSTREAM_INSPECTION_BASELINES.appwrite.pinnedCommit,
    license: "BSD-3-Clause",
    sourcePath: "docker-compose.yml",
    summary:
      "Live throughput, Docker socket privilege boundaries (`/var/run/docker.sock` in `appwrite-traefik` and installer), and Open Runtimes container isolation were not benchmarked on an ALO Linux host.",
    limitations:
      "Mounting `/var/run/docker.sock` into web-facing containers violates ALO's host security policy; upstream self-hosted Appwrite remains deferred to dedicated isolated VPS nodes.",
  },
]);

export const APPWRITE_RECONSTRUCTION_MATRIX: readonly ReconstructedCapability[] = Object.freeze([
  {
    id: "cloud-projects-console",
    appwriteService: "Organization & Projects + Console (`apps/console`)",
    title: "Unified Cloud Projects Workspace (`/cloud`)",
    evidenceIds: ["ev-appwrite-console-profile", "ev-appwrite-services-catalog", "ev-rea-skill-source-route"],
    portalSurface: "/cloud, /api/cloud/projects, App Center `cloud-baas`",
    operationalState: "AVAILABLE",
    executableRuntimeAttached: false,
    whatWorksNow:
      "Multi-tenant Organization -> Cloud Project workspace with unique project slugs, stage (`development`/`staging`/`production`), region, RBAC isolation, and atomic audit logs.",
    designDifference:
      "Built natively on Next.js 16 + Prisma + SQLite (`cloud_projects`) instead of a separate Bun/TanStack Console talking to a PHP/Swoole backend.",
    remainingGate: "Apply additive migration `20261102120000_cloud_baas_projects` via `scripts/apply-deploy-schema.mjs` on target DB.",
  },
  {
    id: "scoped-project-keys",
    appwriteService: "Project API Keys & Scopes (`app/config/scopes/project.php`)",
    title: "Granular Scoped API Keys & `/api/cloud/v1/health` Verification",
    evidenceIds: ["ev-appwrite-project-scopes", "ev-rea-agents-provenance"],
    portalSurface: "/api/cloud/projects/[id]/keys, /api/cloud/v1/health",
    operationalState: "AVAILABLE",
    executableRuntimeAttached: false,
    whatWorksNow:
      "17 granular scopes across Project, Sites, Databases, Storage, Functions, Users, Messaging, Webhooks, and Health; one-time secret reveal; SHA-256 hash storage; constant-time verification; expiry & revocation.",
    designDifference:
      "Uses `alok_live_` prefixed high-entropy keys verified via `x-alo-project` + `x-alo-key` headers without ambient cookie authority.",
    remainingGate: "Extend per-service data-plane endpoints beyond `/api/cloud/v1/health` as tenant SDK workloads grow.",
  },
  {
    id: "client-platforms-cors",
    appwriteService: "Project Platforms (`platforms.read/write`, `src/Appwrite/Network`)",
    title: "Registered Web, Flutter, Apple & Android Client Platforms",
    evidenceIds: ["ev-appwrite-project-scopes", "ev-appwrite-services-catalog"],
    portalSurface: "/api/cloud/projects/[id]/platforms",
    operationalState: "AVAILABLE",
    executableRuntimeAttached: false,
    whatWorksNow:
      "Registers allowed Web/Next.js hostnames (rejecting `localhost` on `production` projects) and reverse-DNS iOS/macOS/Android/Flutter bundle identifiers per project.",
    designDifference:
      "Stored in `cloud_project_platforms` with deterministic Zod hostname and bundle-ID validation.",
    remainingGate: "Wire dynamic CORS origin lookup from `cloud_project_platforms` when public browser SDK data routes are enabled.",
  },
  {
    id: "project-event-webhooks",
    appwriteService: "Webhooks (`Modules/Webhooks`, `app/config/events.php`)",
    title: "SSRF-Guarded HTTPS Event Webhooks & HMAC Signing",
    evidenceIds: ["ev-appwrite-services-catalog", "ev-rea-agents-provenance"],
    portalSurface: "/api/cloud/projects/[id]/webhooks",
    operationalState: "AVAILABLE",
    executableRuntimeAttached: false,
    whatWorksNow:
      "Configures project webhooks subscribed to structured Sites/Databases/Storage/Functions/Users events with strict HTTPS + SSRF target validation and one-time HMAC-SHA256 signing secrets.",
    designDifference:
      "Signing keys are hashed at rest (`signingKeyHash`) rather than stored in reversible form unless an outbound dispatcher vault is configured.",
    remainingGate: "Connect background outbound webhook delivery queue with bounded retry and egress allowlist.",
  },
  {
    id: "sites-framework-adapters",
    appwriteService: "Appwrite Sites (`Modules/Sites`, `app/config/frameworks.php`)",
    title: "Sites Framework Adapters Linked to Git Deployments",
    evidenceIds: ["ev-appwrite-sites-frameworks", "ev-appwrite-console-profile"],
    portalSurface: "/cloud (Sites tab), /sites, /deployments",
    operationalState: "AVAILABLE",
    executableRuntimeAttached: false,
    whatWorksNow:
      "10 verified framework presets (Next.js, TanStack Start, SvelteKit, Astro, Nuxt, Vue, Angular, Analog, React, Static) with SSR/Static build commands, output paths, and direct binding to existing `Website` & `GitProject` records.",
    designDifference:
      "Reuses ALO's atomic-symlink Git autodeploy pipeline (`/deployments`) instead of Appwrite's Docker-based Open Runtimes site containers.",
    remainingGate: "Full end-to-end host verification remains governed by `docs/SELF-HOSTED-ACCEPTANCE-GATE.md`.",
  },
  {
    id: "databases-storage-auth-bridge",
    appwriteService: "Databases / TablesDB, Storage Buckets & Auth",
    title: "Unified Project Binding to Databases, Storage Buckets & RBAC",
    evidenceIds: ["ev-appwrite-services-catalog", "ev-appwrite-console-profile"],
    portalSurface: "/cloud, /databases, /storage, /users",
    operationalState: "AVAILABLE",
    executableRuntimeAttached: false,
    whatWorksNow:
      "Links each Cloud Project to tenant-verified `DatabaseInstance` and `StorageBucket` records with cross-tenant ownership checks, unified health status, and deep links.",
    designDifference:
      "Avoids duplicating existing `/databases` and `/storage` tables; `CloudProject` acts as the project control-plane anchor.",
    remainingGate: "Per-row/document query APIs (`TablesDB` style) remain a separate future phase if client SDKs need direct table queries.",
  },
  {
    id: "serverless-functions-registry",
    appwriteService: "Appwrite Functions (`Modules/Functions`, `src/Executor`)",
    title: "Cloud Functions Registry with Honest `REQUIRES_SETUP` Execution State",
    evidenceIds: ["ev-appwrite-functions-module", "ev-appwrite-runtime-unknown"],
    portalSurface: "/api/cloud/projects/[id]/functions",
    operationalState: "REQUIRES_SETUP",
    executableRuntimeAttached: false,
    whatWorksNow:
      "Defines project functions with pinned runtimes (`node-22`, `bun-1.4`, `deno-2.1`, `python-3.12`, `go-1.23`, `php-8.4`), validated entrypoints, event triggers, and 5-field cron schedules.",
    designDifference:
      "Never fabricates function execution or mounts `/var/run/docker.sock`; every function explicitly reports `executionState: REQUIRES_SETUP`.",
    remainingGate: "Provision an isolated, rootless container runner on a dedicated worker host before enabling function builds or invocations.",
  },
  {
    id: "advisor-and-agent-mcp",
    appwriteService: "Advisor (`Modules/Advisor`) & Appwrite MCP (`README.md#agents`)",
    title: "Deterministic Project Posture Advisor & Secret-Free Agent/SDK Onboarding",
    evidenceIds: ["ev-appwrite-advisor-mcp", "ev-rea-skill-source-route"],
    portalSurface: "/cloud (Overview & Agents/SDK tabs), workflow node `hosting.cloudProjects`",
    operationalState: "AVAILABLE",
    executableRuntimeAttached: false,
    whatWorksNow:
      "Evaluates real project state (missing key expiry, wildcard scopes, missing platforms/webhooks, unlinked SSL sites, unattached function executor) and generates secret-free SDK/curl/MCP configs plus a read-only AI workflow node.",
    designDifference:
      "100% deterministic local rules with zero model hallucination and zero plaintext credential interpolation.",
    remainingGate: "Optional hosted OAuth MCP server remains deferred until multi-tenant scope consent review passes.",
  },
]);

/** Validate all static ledger records on module load so drift fails fast in tests. */
export function verifyReconstructionLedgerIntegrity() {
  const evidenceIds = new Set<string>();
  for (const item of APPWRITE_REA_EVIDENCE_LEDGER) {
    ReaSourceEvidenceSchema.parse(item);
    if (evidenceIds.has(item.evidenceId)) {
      throw new Error(`Duplicate REA evidence ID: ${item.evidenceId}`);
    }
    evidenceIds.add(item.evidenceId);
  }
  const capabilityIds = new Set<string>();
  for (const cap of APPWRITE_RECONSTRUCTION_MATRIX) {
    ReconstructedCapabilitySchema.parse(cap);
    if (capabilityIds.has(cap.id)) {
      throw new Error(`Duplicate reconstructed capability ID: ${cap.id}`);
    }
    capabilityIds.add(cap.id);
    for (const ref of cap.evidenceIds) {
      if (!evidenceIds.has(ref)) {
        throw new Error(`Capability ${cap.id} cites unknown evidence ID ${ref}`);
      }
    }
  }
  return {
    baselines: UPSTREAM_INSPECTION_BASELINES,
    evidenceCount: APPWRITE_REA_EVIDENCE_LEDGER.length,
    capabilityCount: APPWRITE_RECONSTRUCTION_MATRIX.length,
    evidence: APPWRITE_REA_EVIDENCE_LEDGER,
    capabilities: APPWRITE_RECONSTRUCTION_MATRIX,
  };
}
