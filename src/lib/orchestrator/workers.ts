/**
 * The specialized worker registry.
 *
 * Ten bounded workers, one per operational concern. They share the job contract
 * in `contracts.ts` so the orchestrator can queue, retry, gate and audit them
 * identically.
 *
 * Two honesty rules are enforced here, in code:
 *
 *  1. **Reuse, don't duplicate.** The deployment path already has a verified
 *     engine (`src/lib/deploy/engine.ts`), real framework detection
 *     (`detect.ts`) and signed webhooks (`webhook.ts`). BUILD_TEST and
 *     FRAMEWORK_DETECTION delegate to them instead of reimplementing a second
 *     pipeline that could drift.
 *  2. **Never fake a success.** A worker whose `execution` mode is AGENT or
 *     EXTERNAL cannot complete without a reachable, enrolled agent or a
 *     configured credential. In that case it fails with an explicit code
 *     (`AGENT_UNAVAILABLE`, `NOT_CONFIGURED`) and `verified: false`, so the
 *     dashboard shows a real blocker rather than a green tick.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Resolver } from "node:dns/promises";
import tls from "node:tls";
import { z } from "zod";
import { db } from "@/lib/db";
import { redact } from "@/lib/deploy/redact";
import { validateRepositoryName, getCommit, resolveToken, fetchRepoManifests } from "@/lib/deploy/github";
import { detectFramework, memoryReader } from "@/lib/deploy/detect";
import { detectNativeBuildPlan } from "@/lib/deploy/native-build";
import { runDeployment, rollbackProject } from "@/lib/deploy/engine";
import { validateDeployConfig } from "@/lib/deploy/config";
import { readMarker, currentReleaseDir } from "@/lib/deploy/service";
import { defineWorker, fail, ok, unverified, WorkerError, type JobFinding, type WorkerDefinition, type Scope } from "./contracts";
import { findAllowlistEntry } from "@/lib/agents/allowlist";
import { agentOnline } from "@/lib/agents/agent";

const execFileAsync = promisify(execFile);

const workers = new Map<string, WorkerDefinition<any, any>>();

/**
 * Resolve the least-privileged GitHub token for a connection id.
 * Returns `token: null` (never throws) so callers can report an honest
 * "credential not configured" result instead of crashing the job.
 * A deleted or revoked connection never falls back to the platform token
 * (SEC-02: revoking a connection must immediately stop builds/discovery on it).
 */
async function tokenForConnection(connectionId: string | null | undefined) {
  if (!connectionId) return resolveToken(null);
  const connection = await db.gitConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.status !== "active") {
    return { mode: "none" as const, token: null, label: connection ? "revoked connection" : "missing connection" };
  }
  return resolveToken({
    mode: connection.mode,
    installationId: connection.installationId,
    tokenEncrypted: connection.tokenEncrypted,
  });
}

export function registerWorker(def: WorkerDefinition<any, any>): void {
  workers.set(def.kind, def);
}

export function getWorker(kind: string): WorkerDefinition<any, any> | undefined {
  return workers.get(kind);
}

export function listWorkers(): Array<{
  kind: string;
  label: string;
  description: string;
  execution: string;
  maxRisk: string;
  requiredScopes: string[];
}> {
  return [...workers.values()].map((w) => ({
    kind: w.kind,
    label: w.label,
    description: w.description,
    execution: w.execution,
    maxRisk: w.maxRisk,
    requiredScopes: [...w.requiredScopes],
  }));
}

// ─── 1. Repository discovery ────────────────────────────────────────────────
// Validates access and reads the selected commit. It never executes repository
// code and never runs with production privileges.

const repoDiscoveryInput = z.object({
  projectId: z.string().min(1).optional(),
  repository: z.string().min(3).optional(),
  ref: z.string().min(1).max(200).optional(),
  connectionId: z.string().min(1).optional(),
});

registerWorker(
  defineWorker<z.infer<typeof repoDiscoveryInput>, unknown>({
    kind: "REPO_DISCOVERY",
    label: "Repository discovery",
    description:
      "Validates repository access, resolves the exact commit and reports the branch, author and tree shape. Read-only: it never checks out or executes repository code.",
    execution: "LOCAL",
    maxRisk: "READ_ONLY",
    requiredScopes: ["repo:read"],
    retrySafe: true,
    defaultMaxAttempts: 3,
    defaultTimeoutMs: 60_000,
    inputSchema: repoDiscoveryInput,
    async handler(input, ctx) {
      await ctx.progress(10, "resolving repository");

      let repository = input.repository;
      let connectionId = input.connectionId ?? null;
      if (input.projectId) {
        const project = await db.gitProject.findUnique({ where: { id: input.projectId } });
        if (!project) throw new WorkerError("NOT_FOUND", `Project ${input.projectId} not found`);
        repository = repository ?? project.repository;
        connectionId = connectionId ?? project.connectionId;
      }
      if (!repository) throw new WorkerError("VALIDATION_FAILED", "repository or projectId is required");

      const normalised = validateRepositoryName(repository);
      await ctx.progress(35, `repository ${normalised} accepted by the name guard`);

      const ref = input.ref ?? "HEAD";
      // The staging harness may pin a local checkout. This path is opt-in on
      // the server, never accepted from a webhook, and verifies the exact SHA
      // with git before any build is allowed.
      if (input.projectId && process.env.DEPLOY_ALLOW_LOCAL_SOURCE === "true") {
        const project = await db.gitProject.findUnique({ where: { id: input.projectId } });
        if (project?.cloneUrl.startsWith("/")) {
          const resolved = await execFileAsync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: project.cloneUrl, timeout: 15_000 }).catch(() => null);
          const sha = resolved?.stdout.trim();
          if (!sha || !/^[0-9a-f]{40}$/.test(sha)) return unverified({ repository: normalised, ref }, "Local staging ref could not be resolved; nothing was verified");
          return ok({ repository: normalised, ref, sha, verifiedAgainst: "local git checkout" }, `Verified local staging ref ${ref} resolves to ${sha.slice(0, 12)}`, { evidence: `localCommit=${sha}` });
        }
      }
      const token = await tokenForConnection(connectionId).catch(() => resolveToken(null));

      if (!token.token) {
        // No credential: we can still report what is known locally, but we must
        // not claim the remote ref was verified.
        const project = input.projectId
          ? await db.gitProject.findUnique({ where: { id: input.projectId } })
          : await db.gitProject.findFirst({ where: { repository: normalised } });
        return unverified(
          {
            repository: normalised,
            ref,
            lastKnownCommitSha: project?.lastCommitSha ?? null,
            lastCommitMessage: project?.lastCommitMessage ?? null,
            productionBranch: project?.productionBranch ?? null,
          },
          "No GitHub credential is configured for this connection; the remote ref was not verified. Add a GitHub App/OAuth connection to enable remote discovery.",
          {
            findings: [
              {
                severity: "warning",
                title: "Remote verification skipped",
                detail: "resolveToken() returned no token for this connection.",
                remediation: "Connect GitHub in /deployments, then re-run discovery.",
              },
            ],
          },
        );
      }

      const commit = await getCommit(token.token, normalised, ref);
      if (!commit) {
        return unverified(
          { repository: normalised, ref },
          `The GitHub API did not resolve ${normalised}@${ref} (missing, private without permission, or an unreachable API). Nothing was verified.`,
          { findings: [{ severity: "warning", title: "Ref could not be resolved", detail: `${normalised}@${ref}`, remediation: "Check the branch name and the installation's repository access." }] },
        );
      }
      await ctx.progress(80, `resolved ${ref} → ${commit.sha.slice(0, 12)}`);
      return ok(
        {
          repository: normalised,
          ref,
          sha: commit.sha,
          message: commit.message,
          author: commit.author,
          verifiedAgainst: "github api",
        },
        `Verified ${normalised}@${ref} resolves to commit ${commit.sha.slice(0, 12)} via the GitHub API`,
      );
    },
  }),
);

// ─── 2. Framework detection ─────────────────────────────────────────────────
// Delegates to the existing, tested detector. Produces a validated manifest and
// asks for clarification instead of guessing when confidence is low.

const frameworkDetectionInput = z.object({
  projectId: z.string().min(1).optional(),
  /** Inline manifest contents, used by tests and by the detection API. */
  files: z.record(z.string(), z.string()).optional(),
});

registerWorker(
  defineWorker<z.infer<typeof frameworkDetectionInput>, unknown>({
    kind: "FRAMEWORK_DETECTION",
    label: "Framework detection",
    description:
      "Identifies the runtime, package manager, lockfile, build/start commands, output directory and health-check path, then emits a validated deployment manifest. Flags ambiguity instead of guessing.",
    execution: "LOCAL",
    maxRisk: "READ_ONLY",
    requiredScopes: ["repo:read"],
    retrySafe: true,
    defaultMaxAttempts: 2,
    defaultTimeoutMs: 60_000,
    inputSchema: frameworkDetectionInput,
    async handler(input, ctx) {
      await ctx.progress(20, "reading project manifests");

      if (input.files) {
        const detection = await detectFramework(memoryReader(input.files));
        return detectionResult(detection, "inline manifests");
      }

      if (!input.projectId) throw new WorkerError("VALIDATION_FAILED", "projectId or files is required");
      const project = await db.gitProject.findUnique({ where: { id: input.projectId } });
      if (!project) throw new WorkerError("NOT_FOUND", `Project ${input.projectId} not found`);

      if (project.detection) {
        try {
          const stored = JSON.parse(project.detection);
          const manifests = projectManifestsFromDetection(stored);
          if (Object.keys(manifests).length === 0 && typeof stored.framework === "string" && typeof stored.confidence === "string" && ["detected", "confirmed"].includes(project.detectionStatus)) {
            return detectionResult(stored, `stored import detection for ${project.repository}`, { repository: project.repository, detectionStatus: project.detectionStatus });
          }
          const detection = await detectFramework(memoryReader(manifests));
          return detectionResult(detection, `stored detection for ${project.repository}`, {
            repository: project.repository,
            detectionStatus: project.detectionStatus,
          });
        } catch {
          // fall through to a fresh detection attempt below
        }
      }

      const token = await tokenForConnection(project.connectionId).catch(() => resolveToken(null));
      if (!token.token) {
        return unverified(
          { repository: project.repository, detectionStatus: project.detectionStatus },
          "Detection needs a GitHub credential to read the repository tree; none is configured. The stored detection (if any) was not re-verified.",
        );
      }

      const fetched = await fetchRepoManifests(token.token, project.repository, project.productionBranch);
      const detection = await detectFramework(memoryReader(fetched.files));
      await ctx.progress(75, `detected ${detection.framework} (${detection.confidence} confidence)`);
      return detectionResult(detection, `fresh detection of ${project.repository}@${project.productionBranch}`, {
        repository: project.repository,
        detectionStatus: detection.ambiguous ? "ambiguous" : "detected",
      });
    },
  }),
);

function detectionResult(detection: Awaited<ReturnType<typeof detectFramework>>, source: string, extra?: Record<string, unknown>) {
  const findings: JobFinding[] = detection.warnings.map((w) => ({ severity: "warning", title: w }));
  if (detection.ambiguous) {
    findings.unshift({
      severity: "critical",
      title: "Detection is ambiguous — confirmation required",
      remediation: "Review the manifest in /deployments and confirm the build settings before deploying.",
    });
  }
  const result = {
    ...detection,
    source,
    ...(extra ?? {}),
  };
  // Ambiguous detection is not a failure, but it must never be reported as a
  // verified, ready-to-run manifest.
  return detection.ambiguous
    ? unverified(result, `${detection.framework} detected from ${source}, but the manifest is ambiguous and needs confirmation`, { findings })
    : ok(result, `Detected ${detection.framework} / ${detection.runtime} from ${source} with ${detection.confidence} confidence`, { findings });
}

function projectManifestsFromDetection(stored: Record<string, unknown>): Record<string, string> {
  const files: Record<string, string> = {};
  if (stored && typeof stored === "object") {
    const manifests = (stored as { manifests?: Record<string, string> }).manifests;
    if (manifests && typeof manifests === "object") {
      for (const [name, content] of Object.entries(manifests)) {
        if (typeof content === "string") files[name] = content;
      }
    }
  }
  return files;
}

// ─── Native CMake build planning ───────────────────────────────────────────
// Read-only planning only. Native execution requires a separately enrolled,
// isolated runner and is deliberately not routed through the web deploy engine.

const nativeBuildPlanInput = z.object({
  projectId: z.string().min(1).optional(),
  files: z.record(z.string(), z.string()).optional(),
  platform: z.enum(["linux", "windows", "macos"]).default("linux"),
}).refine((value) => Boolean(value.projectId || value.files), {
  message: "projectId or files is required",
});

registerWorker(
  defineWorker<z.infer<typeof nativeBuildPlanInput>, unknown>({
    kind: "NATIVE_BUILD_PLAN",
    label: "Native application build planning",
    description:
      "Reads CMake manifests, selects safe platform presets, detects submodules and emits a build plan. Does not execute source code or claim a native build succeeded.",
    execution: "LOCAL",
    maxRisk: "READ_ONLY",
    requiredScopes: ["repo:read"],
    retrySafe: true,
    defaultMaxAttempts: 2,
    defaultTimeoutMs: 60_000,
    inputSchema: nativeBuildPlanInput,
    async handler(input, ctx) {
      await ctx.progress(15, "reading native build manifests");
      let files = input.files;

      if (!files) {
        const project = await db.gitProject.findUnique({ where: { id: input.projectId! } });
        if (!project) throw new WorkerError("NOT_FOUND", `Project ${input.projectId} not found`);
        const token = await tokenForConnection(project.connectionId).catch(() => resolveToken(null));
        if (!token.token) {
          return unverified(
            { projectId: project.id, repository: project.repository, platform: input.platform },
            "A GitHub credential is required to read this repository. No native build was started.",
          );
        }
        const fetched = await fetchRepoManifests(token.token, project.repository, project.productionBranch);
        files = fetched.files;
      }

      const plan = await detectNativeBuildPlan(memoryReader(files), input.platform);
      if (!plan) {
        return unverified(
          { platform: input.platform },
          "No root CMakeLists.txt was found. This planner currently handles CMake projects only.",
        );
      }

      await ctx.progress(85, `CMake project detected; plan status ${plan.status}`);
      if (plan.status !== "READY_FOR_RUNNER") {
        return unverified(
          plan,
          "Native build plan needs configuration. No commands were executed.",
          { findings: plan.blockers.map((blocker) => ({ severity: "warning" as const, title: blocker })) },
        );
      }

      return ok(
        plan,
        `Prepared a ${input.platform} CMake build plan. No native runner was invoked and no artifact was produced.`,
        { evidence: `configurePreset=${plan.configurePreset}; buildPreset=${plan.buildPreset}; submodules=${plan.submodules.length}` },
      );
    },
  }),
);

// ─── 3. Build & test ────────────────────────────────────────────────────────
// Delegates to the verified deployment engine: isolated mkdtemp build, exact
// SHA, lint/typecheck/test/build, atomic symlink activation, HTTP + release
// marker verification and automatic restore on failed verification.

const buildTestInput = z.object({
  deploymentId: z.string().min(1),
});

registerWorker(
  defineWorker<z.infer<typeof buildTestInput>, unknown>({
    kind: "BUILD_TEST",
    label: "Build & test",
    description:
      "Runs the existing deployment engine for one exact commit: isolated checkout, reproducible install, lint/typecheck/test/build, atomic activation, then HTTP and release-marker verification with automatic restore on failure.",
    execution: "LOCAL",
    maxRisk: "REVERSIBLE",
    requiredScopes: ["build:run", "release:write"],
    retrySafe: false,
    defaultMaxAttempts: 1, // the engine already restores the previous release; blind retries are unsafe
    defaultTimeoutMs: 30 * 60_000,
    inputSchema: buildTestInput,
    async handler(input, ctx) {
      const deployment = await db.deployment.findUnique({ where: { id: input.deploymentId } });
      if (!deployment) throw new WorkerError("NOT_FOUND", `Deployment ${input.deploymentId} not found`);

      await ctx.progress(10, `running deployment ${deployment.id} (commit ${deployment.commitHash?.slice(0, 12) ?? "unknown"})`);

      // Remote (node-assigned) deployments run through the remote release
      // engine; the requester's own authorization covers the deployment's
      // activation commands (scopes are still enforced per command).
      if (deployment.projectId) {
        const project = await db.gitProject.findUnique({ where: { id: deployment.projectId }, select: { agentId: true } });
        if (project?.agentId) {
          const { runRemoteDeployment } = await import("@/lib/deploy/remote");
          const result = await runRemoteDeployment(deployment.id, ctx, "requester");
          const fresh = await db.deployment.findUnique({ where: { id: deployment.id }, include: { logs: { orderBy: { timestamp: "asc" }, take: 400 } } });
          if (!fresh) throw new WorkerError("NOT_FOUND", "Deployment vanished during the run");
          if (result.status === "SUCCESS") {
            return ok(
              {
                deploymentId: fresh.id,
                status: fresh.status,
                stage: fresh.stage,
                commitHash: fresh.commitHash,
                verifiedCommitSha: fresh.verifiedCommitSha,
                releaseId: fresh.releaseId,
                durationMs: fresh.durationMs,
                executedOn: "node-agent",
              },
              `Remote deployment ${fresh.id} succeeded on its assigned node; live commit ${String(fresh.verifiedCommitSha ?? fresh.commitHash).slice(0, 12)} verified by agent probe and release marker`,
              { evidence: `stage=${fresh.stage}; verifiedCommitSha=${fresh.verifiedCommitSha ?? "n/a"}; engine=node-agent` },
            );
          }
          const tail = fresh.logs.filter((l) => l.level === "ERROR" || l.level === "WARN").slice(-8).map((l) => `${l.level}: ${l.message}`);
          return fail(
            result.status === "ROLLED_BACK" ? "ROLLED_BACK" : "BUILD_FAILED",
            `Remote deployment ${fresh.id} ${result.status} at stage ${result.stage}. ${result.status === "ROLLED_BACK" ? "The previous release was restored." : "The node's live release was never switched."}`,
            { findings: tail.map((t) => ({ severity: "critical", title: t.slice(0, 200) })) },
          );
        }
      }

      await runDeployment(deployment.id);

      const fresh = await db.deployment.findUnique({
        where: { id: deployment.id },
        include: { logs: { orderBy: { timestamp: "asc" }, take: 400 } },
      });
      if (!fresh) throw new WorkerError("NOT_FOUND", "Deployment vanished during the run");

      const stage = fresh.stage ?? "unknown";
      await ctx.progress(90, `deployment finished with status ${fresh.status} at stage ${stage}`);

      if (fresh.status === "SUCCESS") {
        return ok(
          {
            deploymentId: fresh.id,
            status: fresh.status,
            stage,
            commitHash: fresh.commitHash,
            verifiedCommitSha: fresh.verifiedCommitSha,
            releaseId: fresh.releaseId,
            durationMs: fresh.durationMs,
          },
          `Deployment ${fresh.id} succeeded and the live commit ${String(fresh.verifiedCommitSha ?? fresh.commitHash).slice(0, 12)} was verified over HTTP`,
          { evidence: `stage=${stage}; verifiedCommitSha=${fresh.verifiedCommitSha ?? "n/a"}` },
        );
      }

      const tail = fresh.logs
        .filter((l) => l.level === "ERROR" || l.level === "WARN")
        .slice(-8)
        .map((l) => `${l.level}: ${l.message}`);
      // A failed build must never silently replace the known-good release; the
      // engine guarantees that, and we report the failing stage explicitly.
      return fail(
        fresh.status === "ROLLED_BACK" ? "ROLLED_BACK" : "BUILD_FAILED",
        `Deployment ${fresh.id} ${fresh.status} at stage ${stage}. The previous release was left live.`,
        { findings: tail.map((t) => ({ severity: "critical", title: t.slice(0, 200) })) },
      );
    },
  }),
);

// ─── 4. Security analysis ───────────────────────────────────────────────────
// Static, deterministic checks. Never silently suppresses a critical finding.

const securityAnalysisInput = z.object({
  projectId: z.string().min(1).optional(),
  /** Directory to scan; defaults to the current release of the project. */
  root: z.string().min(1).optional(),
  /** Manifest contents to inspect for risky configuration. */
  files: z.record(z.string(), z.string()).optional(),
});

/** Shapes that must never be committed. Deliberately conservative. */
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; severity: "critical" | "warning" }> = [
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, severity: "critical" },
  { name: "GitHub fine-grained PAT", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, severity: "critical" },
  { name: "AWS access key id", pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: "critical" },
  { name: "Private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, severity: "critical" },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, severity: "critical" },
  { name: "Stripe secret key", pattern: /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/g, severity: "critical" },
  { name: "Database URL with credentials", pattern: /\b(?:mysql|mariadb|postgres(?:ql)?):\/\/[^/\s:@]+:[^/\s@]+@/gi, severity: "critical" },
  { name: "Hardcoded password assignment", pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/gi, severity: "warning" },
];

const RISKY_CONFIG: Array<{ test: (name: string, content: string) => boolean; title: string; detail: string; severity: "critical" | "warning" }> = [
  {
    test: (name, c) => /dockerfile/i.test(name) && /^\s*USER\s+root\s*$/im.test(c),
    title: "Container runs as root",
    detail: "The Dockerfile ends with (or only has) USER root, so a container escape becomes a host compromise.",
    severity: "warning",
  },
  {
    test: (name, c) => /docker-compose.*\.ya?ml$/i.test(name) && /privileged:\s*true/i.test(c),
    title: "Privileged container",
    detail: "`privileged: true` gives the container full host capabilities.",
    severity: "critical",
  },
  {
    test: (name, c) => /docker-compose.*\.ya?ml$/i.test(name) && /\/var\/run\/docker\.sock/i.test(c),
    title: "Docker socket mounted",
    detail: "Mounting /var/run/docker.sock is equivalent to root on the host.",
    severity: "critical",
  },
  {
    test: (name, c) => /\.env(\.|$)/i.test(name) && /=.+/.test(c),
    title: "Committed .env file",
    detail: "Environment files belong in a secret store, never in the repository.",
    severity: "critical",
  },
  {
    test: (name, c) => /next\.config\.(js|mjs|ts)$/i.test(name) && /ignoreBuildErrors:\s*true/i.test(c),
    title: "Build error checking disabled",
    detail: "`typescript.ignoreBuildErrors` lets type-unsafe code reach production.",
    severity: "warning",
  },
  {
    test: (name, c) => /next\.config\.(js|mjs|ts)$/i.test(name) && /ignoreDuringBuilds:\s*true/i.test(c),
    title: "ESLint disabled during builds",
    detail: "`eslint.ignoreDuringBuilds` removes a cheap safety net from the pipeline.",
    severity: "warning",
  },
];

registerWorker(
  defineWorker<z.infer<typeof securityAnalysisInput>, unknown>({
    kind: "SECURITY_ANALYSIS",
    label: "Security analysis",
    description:
      "Scans the release tree or supplied manifests for committed secrets, risky container/build configuration and unsafe deployment settings. Critical findings always fail the job.",
    execution: "LOCAL",
    maxRisk: "READ_ONLY",
    requiredScopes: ["repo:read"],
    retrySafe: true,
    defaultMaxAttempts: 2,
    defaultTimeoutMs: 3 * 60_000,
    inputSchema: securityAnalysisInput,
    async handler(input, ctx) {
      const findings: Array<{ severity: "info" | "warning" | "critical"; title: string; detail?: string; remediation?: string }> = [];
      let scanned = 0;

      const inspect = (name: string, content: string) => {
        scanned++;
        for (const { name: label, pattern, severity } of SECRET_PATTERNS) {
          pattern.lastIndex = 0;
          const match = pattern.exec(content);
          if (match) {
            findings.push({
              severity,
              title: `${label} found in ${name}`,
              detail: "The value is not reproduced here; only its location is reported.",
              remediation: "Remove it from the repository, rotate the credential, store it as an environment secret and add the path to .gitignore.",
            });
          }
        }
        for (const rule of RISKY_CONFIG) {
          if (rule.test(name, content)) {
            findings.push({ severity: rule.severity, title: rule.title, detail: `${name}: ${rule.detail}` });
          }
        }
      };

      if (input.files) {
        await ctx.progress(30, `scanning ${Object.keys(input.files).length} supplied manifest(s)`);
        for (const [name, content] of Object.entries(input.files)) inspect(name, content);
      } else {
        // Remote-node deployments keep their release on the node, not on the
        // control plane — there is no local tree to walk. When the project is
        // assigned to an online agent, the node ships a bounded manifest of
        // its active release (deploy.manifest) and the same scan runs over
        // that. A node without a readable release is a real blocker, reported
        // as such.
        let remoteFiles: Record<string, string> | null = null;
        let remoteRoot: string | null = null;
        const localRoot = input.projectId ? await currentReleaseDir(input.projectId).catch(() => null) : null;
        if (!localRoot && input.projectId) {
          const project = await db.gitProject.findUnique({ where: { id: input.projectId }, select: { agentId: true, websiteId: true } });
          const website = project?.websiteId ? await db.website.findUnique({ where: { id: project.websiteId }, select: { domain: true } }) : null;
          if (project?.agentId && website?.domain) {
            const agent = await db.serverAgent.findUnique({ where: { id: project.agentId } });
            if (agent && agentOnline(agent)) {
              const { runAgent } = await import("./platform-workers");
              await ctx.progress(15, `fetching release manifest from node ${agent.name}`);
              const manifest = await runAgent(ctx, project.agentId, "deploy.manifest", { domain: website.domain }, "job", 90_000);
              const data = manifest.data as { files?: Record<string, string>; root?: string; truncated?: boolean };
              remoteFiles = data.files ?? {};
              remoteRoot = data.root ?? null;
            }
          }
        }
        if (remoteFiles) {
          await ctx.progress(30, `scanning ${Object.keys(remoteFiles).length} file(s) from node release ${remoteRoot ?? ""}`);
          for (const [name, content] of Object.entries(remoteFiles)) inspect(name, content);
        } else {
          const root = await resolveScanRoot(input);
          await ctx.progress(20, `scanning ${root}`);
          for await (const rel of walk(root, 400)) {
            const filePath = path.join(/*turbopackIgnore: true*/ root, rel);
            const content = await fs.readFile(/*turbopackIgnore: true*/ filePath, "utf8").catch(() => null);
            if (content === null) continue;
            inspect(rel, content);
            if (scanned >= 400) break;
          }
        }
      }

      await ctx.progress(85, `scanned ${scanned} file(s), ${findings.length} finding(s)`);

      const critical = findings.filter((f) => f.severity === "critical");
      const summary = { scannedFiles: scanned, findings, criticalCount: critical.length };

      if (critical.length > 0) {
        // Never silently suppressed: a critical finding fails the job.
        return fail("SECURITY_CRITICAL", `${critical.length} critical security finding(s) block this release`, {
          data: summary,
          findings,
        });
      }
      return findings.length > 0
        ? { ok: true, code: "OK_WITH_WARNINGS", message: `${findings.length} non-blocking finding(s) across ${scanned} file(s)`, data: summary, verified: true, findings }
        : ok(summary, `No secrets or risky configuration found in ${scanned} file(s)`, { findings });
    },
  }),
);

async function resolveScanRoot(input: z.infer<typeof securityAnalysisInput>): Promise<string> {
  if (input.root) return input.root;
  if (input.projectId) {
    const dir = await currentReleaseDir(input.projectId);
    if (dir) return dir;
    throw new WorkerError("NOT_FOUND", `Project ${input.projectId} has no active release to scan`);
  }
  throw new WorkerError("VALIDATION_FAILED", "root, projectId or files is required");
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".turbo", "__pycache__"]);

async function* walk(root: string, budget: number): AsyncGenerator<string> {
  let emitted = 0;
  const stack: string[] = [""];
  while (stack.length && emitted < budget) {
    const rel = stack.pop() as string;
    const abs = path.join(/*turbopackIgnore: true*/ root, rel);
    let names: string[];
    let kinds: Record<string, "dir" | "file">;
    try {
      const entries = await fs.readdir(/*turbopackIgnore: true*/ abs, { withFileTypes: true });
      names = entries.map((e) => String(e.name));
      kinds = Object.fromEntries(entries.map((e) => [String(e.name), e.isDirectory() ? "dir" : e.isFile() ? "file" : "other"] as const)) as Record<string, "dir" | "file">;
    } catch {
      continue;
    }
    for (const name of names) {
      if (emitted >= budget) return;
      const childRel = rel ? `${rel}/${name}` : name;
      if (kinds[name] === "dir") {
        if (!SKIP_DIRS.has(name)) stack.push(childRel);
      } else if (kinds[name] === "file") {
        if (/\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|env|sh|py|php|tf|toml)$/i.test(name) || /dockerfile/i.test(name)) {
          emitted++;
          yield childRel;
        }
      }
    }
  }
}

// ─── 5. Release ─────────────────────────────────────────────────────────────
// Records and reports immutable release identity. Never deploys an unverified
// working tree: the release row must carry a commit SHA and a readable marker.

const releaseInput = z.object({
  projectId: z.string().min(1),
  deploymentId: z.string().min(1).optional(),
});

registerWorker(
  defineWorker<z.infer<typeof releaseInput>, unknown>({
    kind: "RELEASE",
    label: "Release identity",
    description:
      "Reads the active release for a project and verifies its identity: commit SHA, on-disk release marker, version and digest. Refuses to report a release whose marker cannot be read.",
    execution: "LOCAL",
    maxRisk: "READ_ONLY",
    requiredScopes: ["release:write"],
    retrySafe: true,
    defaultMaxAttempts: 2,
    defaultTimeoutMs: 60_000,
    inputSchema: releaseInput,
    async handler(input, ctx) {
      await ctx.progress(25, `locating the active release for project ${input.projectId}`);
      const dir = await currentReleaseDir(input.projectId);
      if (!dir) {
        return fail("NO_ACTIVE_RELEASE", `Project ${input.projectId} has no active release directory`, {
          findings: [{ severity: "warning", title: "No active release", remediation: "Run a deployment for this project first." }],
        });
      }

      const marker = await readMarker(dir);
      const deployment = input.deploymentId
        ? await db.deployment.findUnique({ where: { id: input.deploymentId } })
        : await db.deployment.findFirst({ where: { projectId: input.projectId, status: "SUCCESS" }, orderBy: { createdAt: "desc" } });

      const digest = createHash("sha256").update(`${dir}:${marker?.commitSha ?? ""}:${deployment?.commitHash ?? ""}`).digest("hex").slice(0, 16);
      await ctx.progress(70, `release marker ${marker ? "read" : "missing"} at ${dir}`);

      if (!marker) {
        return unverified(
          { projectId: input.projectId, releaseDir: dir, digest, deploymentStatus: deployment?.status ?? null },
          "The release directory exists but its release marker could not be read, so the live identity is unverified.",
          { findings: [{ severity: "critical", title: "Missing release marker", detail: dir, remediation: "Redeploy so a marker is written, or restore the previous release." }] },
        );
      }

      const matchesDb = !deployment?.commitHash || deployment.commitHash === marker.commitSha;
      return ok(
        {
          projectId: input.projectId,
          releaseDir: dir,
          commitSha: marker.commitSha,
          createdAt: marker.createdAt ?? null,
          repository: marker.repository ?? null,
          branch: marker.branch ?? null,
          deploymentIdInMarker: marker.deploymentId ?? null,
          deploymentId: deployment?.id ?? null,
          deploymentStatus: deployment?.status ?? null,
          digest,
          markerMatchesDatabase: matchesDb,
        },
        `Active release for ${input.projectId} is commit ${String(marker.commitSha).slice(0, 12)} and the on-disk marker ${matchesDb ? "matches" : "DOES NOT match"} the database record`,
        { evidence: `marker.commitSha=${marker.commitSha}; digest=${digest}` },
      );
    },
  }),
);

// ─── 6. Infrastructure ──────────────────────────────────────────────────────
// Narrowly scoped operations through a secure server agent. No root shell is
// ever handed to a model.

const infrastructureInput = z.object({
  agentId: z.string().min(1),
  command: z.string().min(1).max(64),
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** Set on a retry so the worker polls an already-dispatched task instead of
   *  dispatching a second one. */
  taskId: z.string().min(1).optional(),
});

registerWorker(
  defineWorker<z.infer<typeof infrastructureInput>, unknown>({
    kind: "INFRASTRUCTURE",
    label: "Infrastructure operations",
    description:
      "Dispatches an allowlisted command to an enrolled server agent (service status/restart, metrics, health probe, process list). Requires an online agent; refuses anything outside the allowlist and never invents a result while the task is still pending.",
    execution: "AGENT",
    maxRisk: "DESTRUCTIVE",
    requiredScopes: ["server:execute"],
    retrySafe: true, // dispatch uses a deterministic task id per orchestrator job
    riskForInput: (input) => findAllowlistEntry(input.command)?.risk ?? "DESTRUCTIVE",
    scopesForInput: (input) => (findAllowlistEntry(input.command)?.scopes ?? ["server:execute"]) as Scope[],
    // Retries are what let the worker wait for the agent to pick the task up.
    defaultMaxAttempts: 5,
    defaultTimeoutMs: 2 * 60_000,
    inputSchema: infrastructureInput,
    async handler(input, ctx) {
      const agentLib = await import("@/lib/agents/agent");

      // Second and later attempts: poll the task that was already dispatched.
      if (input.taskId) {
        await ctx.progress(50, `polling agent task ${input.taskId}`);
        const existing = await db.agentTask.findUnique({ where: { id: input.taskId } });
        if (!existing) throw new WorkerError("NOT_FOUND", `Agent task ${input.taskId} no longer exists`, false);
        return taskResult(existing, input.command);
      }

      await ctx.progress(20, `dispatching ${input.command} to agent ${input.agentId}`);
      // Record allowlist refusals even when the agent is offline; never dispatch
      // an executable command to a stale host.
      if (!findAllowlistEntry(input.command)) {
        const refused = await agentLib.dispatchTask({ agentId: input.agentId, command: input.command, args: input.args, jobId: ctx.jobId, correlationId: ctx.correlationId, actorEmail: ctx.actor?.email, actorScopes: ctx.actor?.scopes ?? [] });
        throw new WorkerError("REFUSED_BY_ALLOWLIST", refused.refuseReason ?? "Command is not in the platform allowlist", false);
      }
      const agent = await db.serverAgent.findUnique({ where: { id: input.agentId } });
      if (!agent || !agentLib.agentOnline(agent)) {
        throw new WorkerError("AGENT_UNAVAILABLE", `Agent ${input.agentId} is not active and recently reachable; no command was dispatched`, false);
      }
      // The bounded self-healing recovery verbs may be auto-authorized by the
      // documented operator policy (see platform-workers.ts); anything else
      // still requires a human approval recorded on this job.
      const { recoveryPolicyApproval } = await import("./platform-workers");
      const policy = recoveryPolicyApproval(ctx, input.command);
      const dispatched = await agentLib.dispatchTask({
        agentId: input.agentId,
        command: input.command,
        args: input.args,
        jobId: ctx.jobId,
        correlationId: ctx.correlationId,
        actorEmail: ctx.actor?.email,
        actorScopes: ctx.actor?.scopes ?? [],
        approvedBy: policy?.by ?? ctx.approval?.by,
        approvedAt: policy?.at ?? ctx.approval?.at,
      });

      if (dispatched.status === "REFUSED") {
        throw new WorkerError("REFUSED_BY_ALLOWLIST", dispatched.refuseReason ?? "Command is not authorized for this agent", false);
      }

      const task = await db.agentTask.findUnique({ where: { id: dispatched.id } });
      if (!task) throw new WorkerError("NOT_FOUND", `Agent task ${dispatched.id} vanished`, false);

      if (task.status === "PENDING" || task.status === "ASSIGNED") {
        // Honest, retryable state: the task is queued for the host, not done.
        // The retry carries the taskId so the next attempt polls instead of
        // dispatching a duplicate.
        throw new WorkerError(
          "AGENT_TASK_PENDING",
          `Task ${task.id} (${input.command}) is queued for the agent but has not been picked up yet. It will be polled again on the next attempt.`,
          true,
          { taskId: task.id },
        );
      }
      return taskResult(task, input.command);
    },
  }),
);

function taskResult(task: { id: string; status: string; command: string; exitCode: number | null; result: string | null; logs: string | null; error: string | null; refuseReason: string | null }, command: string) {
  if (task.status === "SUCCEEDED") {
    return ok(
      { taskId: task.id, command, exitCode: task.exitCode, result: safeParse(task.result) },
      `Agent executed ${command} and returned exit code ${task.exitCode ?? 0}`,
      { evidence: `agentTaskId=${task.id}; exitCode=${task.exitCode ?? 0}` },
    );
  }
  if (task.status === "REFUSED") {
    throw new WorkerError("REFUSED_BY_ALLOWLIST", task.refuseReason ?? `Agent refused ${command}`, false);
  }
  if (task.status === "TIMED_OUT") {
    throw new WorkerError("AGENT_TASK_PENDING", `Agent task ${task.id} was never claimed within the window`, true);
  }
  return fail("AGENT_TASK_FAILED", `Agent task ${task.id} ended ${task.status}: ${task.error ?? "no detail"}`, {
    data: { taskId: task.id, status: task.status, exitCode: task.exitCode, logs: task.logs },
  });
}

// ─── 7. Database operations ─────────────────────────────────────────────────
// Detects requirements and validates connectivity. Destructive work is gated.

const databaseOpsInput = z.object({
  action: z.enum(["audit", "status", "plan-migration", "provision", "migrate", "restore"]),
  host: z.string().min(1).max(200).optional(),
  serverId: z.string().optional(),
  instanceId: z.string().optional(),
  notes: z.string().max(500).optional(),
});

registerWorker(
  defineWorker<z.infer<typeof databaseOpsInput>, unknown>({
    kind: "DATABASE_OPS",
    label: "Database operations",
    description:
      "Audits the real database engine, replication capability and connectivity, and plans migrations. Provisioning, migrating and restoring require an explicit approval and a verified backup.",
    execution: "AGENT",
    // The worker itself declares the worst thing it can be asked to do. The
    // orchestrator then gates every PRIVILEGED/DESTRUCTIVE job behind a human.
    maxRisk: "DESTRUCTIVE",
    requiredScopes: ["database:read", "database:admin"],
    retrySafe: (input) => ["audit", "status", "plan-migration"].includes(input.action),
    riskForInput: (input) => ["audit", "status", "plan-migration"].includes(input.action) ? "READ_ONLY" : input.action === "restore" ? "DESTRUCTIVE" : "PRIVILEGED",
    scopesForInput: (input) => ["audit", "status", "plan-migration"].includes(input.action) ? ["database:read"] : ["database:read", "database:admin"],
    defaultMaxAttempts: 2,
    defaultTimeoutMs: 5 * 60_000,
    inputSchema: databaseOpsInput,
    async handler(input, ctx) {
      if (input.action === "audit" || input.action === "status") {
        await ctx.progress(30, "reading recorded replication state");
        const rows = await db.replicationStatus.findMany({ orderBy: { updatedAt: "desc" }, take: 20 });
        const instances = await db.databaseInstance.findMany({ take: 20, orderBy: { createdAt: "desc" } });
        if (rows.length === 0) {
          return unverified(
            { instances: instances.map((i) => ({ id: i.id, name: i.name, engine: i.engine, host: i.host, deleted: Boolean(i.deletedAt) })) },
            "No replication audit has been recorded yet. Run scripts/audit-database.mjs on each host; this worker does not guess an engine or a version.",
          );
        }
        return ok(
          {
            replication: rows.map((r) => ({
              host: r.host,
              engine: r.engine,
              version: r.version,
              role: r.role,
              binlogEnabled: r.binlogEnabled,
              gtidMode: r.gtidMode,
              lagSeconds: r.lagSeconds,
              healthy: r.healthy,
              lastCheckedAt: r.lastCheckedAt,
            })),
            instances: instances.map((i) => ({ id: i.id, name: i.name, engine: i.engine, host: i.host, deleted: Boolean(i.deletedAt) })),
          },
          `${rows.length} database host(s) audited; ${rows.filter((r) => r.healthy).length} report healthy`,
          { evidence: `replication_status rows=${rows.length}` },
        );
      }

      if (input.action === "plan-migration") {
        await ctx.progress(40, "building a migration plan");
        return ok(
          {
            plan: [
              "1. Record the current engine, version and schema state (scripts/audit-database.mjs).",
              "2. Take a verified backup and confirm it restores in an isolated environment.",
              "3. Rehearse the migration on a copy, timing it end to end.",
              "4. Freeze writes, apply, then run the application's schema compatibility checks.",
              "5. Verify with the application's own health checks before reopening traffic.",
              "6. Keep the pre-migration backup for the whole rollback window.",
            ],
            rollbackLimitations:
              "A schema migration that drops or rewrites columns cannot be undone by restoring the old code; only the pre-migration backup can.",
            notes: input.notes ?? null,
          },
          "Migration plan produced; nothing was executed",
        );
      }

      // provision | migrate | restore
      const online = await ctx.onlineAgents();
      if (online.length === 0) {
        throw new WorkerError(
          "AGENT_UNAVAILABLE",
          `'${input.action}' must run through an enrolled server agent, and no agent has reported a heartbeat in the last ${Math.round(
            180_000 / 60_000,
          )} minutes. No database was changed.`,
        );
      }
      throw new WorkerError(
        "NOT_IMPLEMENTED",
        `'${input.action}' is gated behind an approval and requires the database adapter for the audited engine. No adapter has been configured for this host, so nothing was executed. This is reported as a failure rather than a success.`,
        false,
      );
    },
  }),
);

// ─── 8. Domain & TLS ────────────────────────────────────────────────────────

const domainTlsInput = z.object({
  action: z.enum(["audit", "verify-ownership", "observe-tls", "plan-dns", "apply-dns", "issue-certificate", "renew"]),
  domain: z.string().min(3).max(253).regex(/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/),
  projectId: z.string().min(1).optional(),
  serverId: z.string().optional(),
  agentId: z.string().min(1).optional(),
  expectedIp: z.ipv4().optional(),
});

async function domainRecord(input: z.infer<typeof domainTlsInput>) {
  let row = await db.domain.findFirst({ where: { domain: input.domain } });
  if (!row && input.projectId) {
    const project = await db.gitProject.findUnique({ where: { id: input.projectId } });
    const website = project ? await db.website.findUnique({ where: { id: project.websiteId } }) : null;
    if (website?.domain === input.domain) row = await db.domain.create({ data: { domain: input.domain, websiteId: website.id, primary: true, nameservers: "[]", sslStatus: "NONE" } });
  }
  return row;
}

function observeCertificate(domain: string): Promise<{ issuer: string; notBefore: Date; notAfter: Date }> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: domain, port: 443, servername: domain, rejectUnauthorized: true, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert?.valid_from || !cert?.valid_to) return reject(new WorkerError("VERIFICATION_REQUIRED", "TLS peer did not return a readable certificate", false));
      const notBefore = new Date(cert.valid_from); const notAfter = new Date(cert.valid_to);
      if (Number.isNaN(notAfter.getTime()) || notAfter.getTime() <= Date.now()) return reject(new WorkerError("VERIFICATION_REQUIRED", "Observed certificate is expired or invalid", false));
      resolve({ issuer: String(cert.issuer?.O ?? cert.issuer?.CN ?? "unknown"), notBefore, notAfter });
    });
    socket.once("error", (error) => reject(new WorkerError("TLS_OBSERVATION_FAILED", error.message, true)));
    socket.once("timeout", () => { socket.destroy(); reject(new WorkerError("TLS_OBSERVATION_FAILED", "TLS observation timed out", true)); });
  });
}

registerWorker(
  defineWorker<z.infer<typeof domainTlsInput>, unknown>({
    kind: "DOMAIN_TLS",
    label: "Domain & TLS",
    description: "Verifies DNS ownership, observes live TLS, applies Cloudflare DNS through the provider API, and issues/renews ACME certificates through an enrolled agent. Never fabricates DNS or certificate state.",
    execution: "EXTERNAL",
    maxRisk: "PRIVILEGED",
    requiredScopes: ["domain:read", "domain:write"],
    // issue/renew are idempotent in the ssl helper (unexpired existing certs
    // are returned as success), so a retried workflow cannot double-issue.
    retrySafe: (input) => ["audit", "plan-dns", "verify-ownership", "observe-tls", "issue-certificate", "renew"].includes(input.action),
    riskForInput: (input) => ["audit", "plan-dns", "verify-ownership", "observe-tls"].includes(input.action) ? "READ_ONLY" : "PRIVILEGED",
    scopesForInput: (input) => ["audit", "plan-dns", "verify-ownership", "observe-tls"].includes(input.action) ? ["domain:read"] : ["domain:read", "domain:write"],
    defaultMaxAttempts: 2,
    defaultTimeoutMs: 5 * 60_000,
    inputSchema: domainTlsInput,
    async handler(input, ctx) {
      await ctx.progress(15, input.action);
      const domain = await domainRecord(input);
      if (input.action === "audit") {
        const cert = domain ? await db.sslCertificate.findUnique({ where: { domainId: domain.id } }) : null;
        return domain ? ok({ domain: { id: domain.id, domain: domain.domain, dnsVerified: domain.dnsVerified, sslStatus: domain.sslStatus, certificateExpiry: domain.certificateExpiry }, certificate: cert }, `Recorded state for ${input.domain}`, { evidence: `domainId=${domain.id}` }) : unverified({ domain: null }, `No recorded domain state for ${input.domain}`);
      }
      if (input.action === "plan-dns") {
        return ok({ domain: input.domain, preview: [{ type: "A", name: input.domain, value: input.expectedIp ?? "<verified node public IPv4>", ttl: 300 }], approvalRequired: true }, "DNS preview produced; nothing was modified", { evidence: "preview-only" });
      }
      if (input.action === "verify-ownership") {
        if (!input.expectedIp) throw new WorkerError("WAITING_EXTERNAL", "expectedIp is required; no verified node public IP is available", false);
        if (!domain) throw new WorkerError("NOT_FOUND", "Domain is not attached to a project", false);
        // Public resolution first — this is the authority for real domains.
        const resolver = new Resolver();
        const addresses = await resolver.resolve4(input.domain).catch(() => [] as string[]);
        let verified = addresses.includes(input.expectedIp);
        let via = "public-dns";
        let evidence = `dns=${addresses.join(",") || "no-answer"}`;
        // Platform-managed domains (the automatically allocated
        // <slug>.<DEPLOY_DOMAIN_SUFFIX> names) are authoritative in the node's
        // local zone, managed through the same agent that serves the app. When
        // public resolution does not cover them, the record is ensured and
        // verified there — reported as local-zone evidence, never as public DNS.
        if (!verified && input.agentId) {
          const suffix = (process.env.DEPLOY_DOMAIN_SUFFIX || "apps.alolabs.net").toLowerCase().replace(/^\.+/, "");
          const zone = input.domain.toLowerCase().endsWith(`.${suffix}`) ? suffix : input.domain;
          const name = input.domain.toLowerCase().endsWith(`.${suffix}`) ? input.domain.toLowerCase().slice(0, -1 * (suffix.length + 1)) : "@";
          const { runAgent } = await import("./platform-workers");
          await runAgent(ctx, input.agentId, "dns.add", { domain: zone, type: "A", name, value: input.expectedIp, ttl: 300 }, "job", 30_000);
          const check = await runAgent(ctx, input.agentId, "dns.verify", { domain: zone, type: "A", name, expected: input.expectedIp }, "job", 30_000);
          const data = check.data as { matches?: boolean; publicMatches?: boolean; zoneValue?: string; resolved?: string };
          verified = Boolean(data.matches);
          via = "node-local-zone";
          evidence = `zone=${zone}:${name}=${data.zoneValue ?? "none"}; public=${data.resolved || "no-answer"}${data.publicMatches ? " (matches)" : ""}`;
        }
        await db.domain.update({ where: { id: domain.id }, data: { dnsVerified: verified } });
        if (!verified) return fail("DNS_NOT_VERIFIED", `${input.domain} does not resolve to ${input.expectedIp} (public answer: [${addresses.join(", ") || "none"}])`, { data: { addresses, expectedIp: input.expectedIp } });
        return ok({ domain: input.domain, addresses, expectedIp: input.expectedIp, verifiedVia: via }, `DNS A record matches the verified node IP (verified via ${via})`, { evidence });
      }
      if (input.action === "apply-dns") {
        if (!input.expectedIp) throw new WorkerError("VALIDATION_FAILED", "expectedIp is required", false);
        const { upsertCloudflareDnsRecord } = await import("@/lib/cloudflare");
        const result = await upsertCloudflareDnsRecord({ type: "A", name: input.domain, content: input.expectedIp, ttl: 300, proxied: false });
        if (!result.success) throw new WorkerError("NOT_CONFIGURED", result.error ?? "DNS provider failed", false);
        if (domain) await db.domain.update({ where: { id: domain.id }, data: { dnsVerified: false } });
        return ok({ domain: input.domain, record: result.data }, "Cloudflare DNS record applied; propagation must still be verified", { evidence: `providerRecordId=${result.data?.id}` });
      }
      if (input.action === "observe-tls") {
        const cert = await observeCertificate(input.domain);
        if (domain) {
          await db.sslCertificate.upsert({ where: { domainId: domain.id }, create: { domainId: domain.id, issuer: cert.issuer, notBefore: cert.notBefore, notAfter: cert.notAfter }, update: { issuer: cert.issuer, notBefore: cert.notBefore, notAfter: cert.notAfter } });
          await db.domain.update({ where: { id: domain.id }, data: { sslEnabled: true, sslStatus: "ISSUED", certificateExpiry: cert.notAfter } });
        }
        return ok({ domain: input.domain, ...cert }, "Live TLS certificate observed and validated", { evidence: `notAfter=${cert.notAfter.toISOString()}` });
      }
      // issue-certificate | renew through an enrolled ACME agent.
      const agentId = input.agentId || process.env.AUTOMATION_DEFAULT_AGENT_ID;
      if (!agentId) throw new WorkerError("NOT_CONFIGURED", "Certificate issuance/renewal requires an enrolled server agent (agentId or AUTOMATION_DEFAULT_AGENT_ID). No certificate was issued.", false);
      if (!domain) throw new WorkerError("NOT_FOUND", "Domain is not attached to a project", false);
      if (!domain.dnsVerified) throw new WorkerError("WAITING_EXTERNAL", "DNS ownership must be verified before certificate issuance", false);
      const { runAgent } = await import("./platform-workers");
      const command = input.action === "renew" ? "ssl.renew" : "ssl.issue";
      const issued = await runAgent(ctx, agentId, command, { domain: input.domain }, "job", 5 * 60_000);
      const info = await runAgent(ctx, agentId, "ssl.info", { domain: input.domain }, "job", 30_000);
      const data = info.data as { notAfter?: string; notBefore?: string; issuer?: string; mode?: string };
      const notAfter = data.notAfter ? new Date(data.notAfter) : null;
      if (!notAfter || Number.isNaN(notAfter.getTime()) || notAfter.getTime() <= Date.now()) throw new WorkerError("VERIFICATION_REQUIRED", "Agent could not verify a valid installed certificate after issuance", false);
      const notBefore = data.notBefore ? new Date(data.notBefore) : new Date();
      // End-to-end proof: a real TLS handshake against the node's listener
      // with SNI for this domain. The certificate must not only exist on disk
      // — it must be the one actually served.
      let handshake: { issuer?: string; notAfter?: string; verifyReturnCode?: string } | null = null;
      try {
        // No port passed on purpose: the node's ssl helper targets its own
        // edge listener (it knows the real port from the edge state file).
        const tlsProbe = await runAgent(ctx, agentId, "ssl.verify-tls", { domain: input.domain }, "job", 30_000);
        handshake = tlsProbe.data as { issuer?: string; notAfter?: string };
      } catch (error) {
        throw new WorkerError("VERIFICATION_REQUIRED", `Certificate is installed but live TLS termination could not be verified: ${error instanceof Error ? error.message : String(error)}`, false);
      }
      await db.sslCertificate.upsert({ where: { domainId: domain.id }, create: { domainId: domain.id, issuer: data.issuer ?? handshake?.issuer ?? "unknown", notBefore, notAfter }, update: { issuer: data.issuer ?? handshake?.issuer ?? "unknown", notBefore, notAfter } });
      await db.domain.update({ where: { id: domain.id }, data: { sslEnabled: true, sslStatus: "ISSUED", certificateExpiry: notAfter } });
      return ok({ domain: input.domain, taskId: issued.taskId, issuer: data.issuer, mode: data.mode ?? "acme", notAfter, tlsHandshakeVerified: true }, `Certificate ${input.action === "renew" ? "renewed" : "issued"} (${data.mode ?? "acme"}), parsed by ssl.info and proven served by a live TLS handshake`, { evidence: `agentTaskId=${issued.taskId}; notAfter=${notAfter.toISOString()}; handshake=ok` });
    },
  }),
);

// ─── 9. Monitoring & recovery ───────────────────────────────────────────────

const monitoringInput = z.object({
  projectId: z.string().min(1).optional(),
  url: z.string().url().max(500).optional(),
  /** Recovery action requested. Bounded, preapproved verbs only. */
  action: z.enum(["check", "recover"]).default("check"),
  expectedCommitSha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
});

registerWorker(
  defineWorker<z.infer<typeof monitoringInput>, unknown>({
    kind: "MONITORING_RECOVERY",
    label: "Monitoring & recovery",
    description:
      "Performs a real HTTP health check of a live release and, for `recover`, restores the previous known-good release. Recovery is bounded to that one preapproved action.",
    execution: "LOCAL",
    maxRisk: "PRIVILEGED",
    requiredScopes: ["monitoring:read", "recovery:execute"],
    retrySafe: (input) => input.action === "check",
    riskForInput: (input) => input.action === "check" ? "READ_ONLY" : "PRIVILEGED",
    scopesForInput: (input) => input.action === "check" ? ["monitoring:read"] : ["monitoring:read", "recovery:execute"],
    defaultMaxAttempts: 3,
    defaultTimeoutMs: 2 * 60_000,
    inputSchema: monitoringInput,
    async handler(input, ctx) {
      if (input.action === "recover") {
        if (!input.projectId) throw new WorkerError("VALIDATION_FAILED", "projectId is required for recovery");
        // Remote (node-assigned) projects roll back through their agent:
        // deploy.rollback (a preapproved recovery verb), then restart the
        // supervised process and verify the live release identity again.
        const remoteProject = await db.gitProject.findUnique({ where: { id: input.projectId }, select: { agentId: true, config: true, websiteId: true } });
        if (remoteProject?.agentId) {
          const config = validateDeployConfig(JSON.parse(remoteProject.config || "{}"));
          const website = await db.website.findUnique({ where: { id: remoteProject.websiteId } });
          if (!website) throw new WorkerError("NOT_FOUND", "Website not found", false);
          const { runAgent } = await import("./platform-workers");
          const before = await runAgent(ctx, remoteProject.agentId, "deploy.list", { domain: website.domain }, "job", 30_000);
          const beforeRelease = String((before.data as { currentRelease?: string | null }).currentRelease ?? "");
          await ctx.progress(30, `node current release ${beforeRelease || "none"}; rolling back to the previous verified release`);
          const rollback = await runAgent(ctx, remoteProject.agentId, "deploy.rollback", { domain: website.domain }, "policy:self-heal", 60_000);
          const after = await runAgent(ctx, remoteProject.agentId, "deploy.list", { domain: website.domain }, "job", 30_000);
          const afterRelease = String((after.data as { currentRelease?: string | null }).currentRelease ?? "");
          if (!afterRelease || afterRelease === beforeRelease) {
            return fail("ROLLBACK_FAILED", `deploy.rollback reported success but the active release is unchanged (${afterRelease || "none"})`, { data: { projectId: input.projectId, beforeRelease, afterRelease, taskId: rollback.taskId } });
          }
          // Restart the supervised process so it serves the restored release
          // (a node process keeps its old modules until restarted), then
          // verify health + release identity through the agent. app.restart is
          // one of the preapproved recovery verbs.
          await runAgent(ctx, remoteProject.agentId, "app.restart", { domain: website.domain }, "policy:self-heal", 60_000);
          // A restored release directory keeps the marker written by the
          // deployment that BUILT it — by definition not the newest deployment
          // row — so verify against the commit identities this platform has
          // actually verified for the project, without pinning the deployment.
          const verifiedRows = await db.deployment.findMany({
            where: { projectId: input.projectId, status: "SUCCESS", verifiedCommitSha: { not: null } },
            select: { verifiedCommitSha: true },
            orderBy: { createdAt: "desc" },
            take: 20,
          });
          const acceptedShas = [...new Set(verifiedRows.map((row) => row.verifiedCommitSha).filter((sha): sha is string => Boolean(sha)))];
          if (acceptedShas.length > 0) {
            const { verifyRemoteRelease } = await import("@/lib/deploy/remote");
            const verified = await verifyRemoteRelease(ctx, remoteProject.agentId, website.domain, { port: config.port, healthPath: config.healthPath }, acceptedShas, null, "job");
            if (!verified.ok) {
              return fail("ROLLBACK_UNVERIFIED", `Rollback to ${afterRelease} did not pass verification (${verified.reason})`, { data: { projectId: input.projectId, beforeRelease, afterRelease } });
            }
            // Record the rollback as the project's newest verified state —
            // the local engine does the same — so future health checks
            // compare against the restored release instead of the deployment
            // that was rolled away from.
            const rollbackDeployment = await db.deployment.create({
              data: {
                websiteId: website.id,
                projectId: input.projectId,
                executedByAgentId: remoteProject.agentId,
                trigger: "rollback",
                source: "rollback",
                status: "SUCCESS",
                stage: "done",
                startedAt: new Date(),
                finishedAt: new Date(),
                commitHash: verified.marker?.commitSha ?? null,
                verifiedCommitSha: verified.marker?.commitSha ?? null,
              },
            });
            await db.website.update({ where: { id: website.id }, data: { currentReleasePath: afterRelease, healthStatus: "HEALTHY" } });
            return ok({ projectId: input.projectId, before: beforeRelease, after: afterRelease, commitSha: verified.marker?.commitSha, rollbackDeploymentId: rollbackDeployment.id, checkedVia: "node-agent" }, `Rolled back to ${afterRelease} on the node and re-verified the live release`, { evidence: `rollbackTaskId=${rollback.taskId}; commit=${verified.marker?.commitSha ?? "n/a"}` });
          }
          return ok({ projectId: input.projectId, before: beforeRelease, after: afterRelease, verifiedIdentity: false }, `Rolled back to ${afterRelease}; no stored verified release identity to compare against`, { evidence: `rollbackTaskId=${rollback.taskId}` });
        }
        const before = await currentReleaseDir(input.projectId);
        await ctx.progress(30, `current release ${before ?? "none"}; rolling back to the last verified release`);
        // Reuse the engine's tested rollback: it picks the last SUCCESS release
        // with a verified commit that still exists on disk, activates it, then
        // re-verifies over HTTP and restores `before` if verification fails.
        let result;
        try {
          result = await rollbackProject(input.projectId, ctx.actor?.id);
        } catch (error) {
          throw new WorkerError("NO_PREVIOUS_RELEASE", error instanceof Error ? error.message : String(error), false);
        }
        const after = await currentReleaseDir(input.projectId);
        if (!result.verified) {
          return fail(
            "ROLLBACK_UNVERIFIED",
            `Rollback to ${result.commitSha.slice(0, 12)} did not pass verification (${result.reason ?? "unknown"}); the previous release was restored`,
            { data: { projectId: input.projectId, before, after, rollback: result } },
          );
        }
        return ok(
          { projectId: input.projectId, before, after, rollback: result },
          `Rolled ${input.projectId} back to verified commit ${result.commitSha.slice(0, 12)} and confirmed it live over HTTP`,
          { evidence: `rollbackDeploymentId=${result.deploymentId}; current=${after}` },
        );
      }

      const target = input.url ?? (input.projectId ? await projectHealthUrl(input.projectId) : null);
      if (!target) throw new WorkerError("VALIDATION_FAILED", "url or projectId is required for a health check");

      await ctx.progress(30, `probing ${redact(target)}`);
      const started = Date.now();
      let status = 0;
      let body = "";
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(target, { signal: controller.signal, redirect: "follow" });
        clearTimeout(timer);
        status = res.status;
        body = (await res.text()).slice(0, 4000);
      } catch (error) {
        return fail("HEALTHCHECK_UNREACHABLE", `Health check could not reach ${redact(target)}: ${error instanceof Error ? error.message : String(error)}`, {
          data: { target: redact(target), latencyMs: Date.now() - started },
        });
      }
      const latencyMs = Date.now() - started;

      const markerCommit = extractCommit(body);
      const expected = input.expectedCommitSha;
      const identityMatches = expected && markerCommit ? markerCommit === expected : null;

      if (status < 200 || status >= 400) {
        return fail("HEALTHCHECK_FAILED", `Health check returned HTTP ${status} in ${latencyMs}ms`, {
          data: { target: redact(target), status, latencyMs },
        });
      }
      if (identityMatches === false) {
        return fail(
          "RELEASE_IDENTITY_MISMATCH",
          `Live release reports commit ${String(markerCommit).slice(0, 12)} but ${String(expected).slice(0, 12)} was expected`,
          { data: { target: redact(target), status, latencyMs, markerCommit, expected } },
        );
      }
      return ok(
        { target: redact(target), status, latencyMs, markerCommit, identityMatches },
        `HTTP ${status} in ${latencyMs}ms${identityMatches === true ? `, release identity confirmed as ${String(markerCommit).slice(0, 12)}` : ""}`,
        { evidence: `http=${status}; latencyMs=${latencyMs}; commit=${markerCommit ?? "not reported"}` },
      );
    },
  }),
);

async function projectHealthUrl(projectId: string): Promise<string | null> {
  const project = await db.gitProject.findUnique({ where: { id: projectId } });
  if (!project) throw new WorkerError("NOT_FOUND", `Project ${projectId} not found`);
  if (project.healthUrl) return project.healthUrl;
  const port = project.port ?? null;
  if (!port) return null;
  return `http://127.0.0.1:${port}${project.healthPath || "/"}`;
}

function extractCommit(body: string): string | null {
  const match = body.match(/\b[0-9a-f]{40}\b/);
  return match ? match[0] : null;
}

// ─── 10. Backup & restore ───────────────────────────────────────────────────

const backupInput = z.object({
  action: z.enum(["verify", "snapshot-record", "restore-drill", "cloud-sqlite-restore"]),
  websiteId: z.string().min(1).optional(),
  backupId: z.string().min(1).optional(),
  /** Cloud-only IDs for the approval-gated isolated SQLite restore path. */
  databaseId: z.string().min(1).optional(),
  cloudBackupId: z.string().min(1).optional(),
  /** Directory to checksum when verifying off-disk artifacts. */
  path: z.string().min(1).optional(),
});

registerWorker(
  defineWorker<z.infer<typeof backupInput>, unknown>({
    kind: "BACKUP_RESTORE",
    label: "Backup & restore",
    description:
      "Verifies backup integrity with real checksums and records restore-drill results. A backup is never reported as verified until the integrity check has actually passed.",
    execution: "LOCAL",
    maxRisk: "DESTRUCTIVE", // restore-drill writes to an isolated target
    requiredScopes: ["backup:read", "backup:write", "backup:restore"],
    retrySafe: (input) => input.action === "verify",
    riskForInput: (input) => input.action === "verify" ? "READ_ONLY" : input.action === "snapshot-record" ? "REVERSIBLE" : "DESTRUCTIVE",
    scopesForInput: (input) => input.action === "verify" ? ["backup:read"] : input.action === "snapshot-record" ? ["backup:write"] : ["backup:read", "backup:restore"],
    defaultMaxAttempts: 2,
    defaultTimeoutMs: 15 * 60_000,
    inputSchema: backupInput,
    async handler(input, ctx) {
      if (input.action === "cloud-sqlite-restore") {
        if (!input.databaseId || !input.cloudBackupId) {
          throw new WorkerError("VALIDATION_FAILED", "databaseId and cloudBackupId are required for Cloud SQLite restore", false);
        }
        await ctx.progress(20, "verifying checksummed Cloud SQLite backup");
        const { restoreCloudSqliteDatabase } = await import("@/lib/cloud/databases");
        const restored = await restoreCloudSqliteDatabase(input.databaseId, input.cloudBackupId);
        await ctx.progress(90, "atomically restored isolated SQLite database from verified backup");
        return ok(restored, `Cloud SQLite database restored from verified backup ${input.cloudBackupId}`, {
          evidence: `databaseId=${input.databaseId}; backupId=${input.cloudBackupId}; sha256=${restored.checksumSha256}`,
        });
      }

      if (input.action === "verify") {
        if (!input.backupId && !input.path) throw new WorkerError("VALIDATION_FAILED", "backupId or path is required");
        const backup = input.backupId ? await db.backup.findUnique({ where: { id: input.backupId } }) : null;
        if (input.backupId && !backup) throw new WorkerError("NOT_FOUND", `Backup ${input.backupId} not found`);

        const target = input.path ?? backup?.filepath;
        if (!target) throw new WorkerError("NOT_FOUND", "No file path is recorded for this backup");

        await ctx.progress(25, `hashing ${path.basename(target)}`);
        let digest: string;
        let sizeBytes: number;
        try {
          const buf = await fs.readFile(target);
          digest = createHash("sha256").update(buf).digest("hex");
          sizeBytes = buf.byteLength;
        } catch (error) {
          if (backup) {
            await db.backup.update({ where: { id: backup.id }, data: { status: "FAILED" } }).catch(() => {});
          }
          return fail(
            "BACKUP_UNREADABLE",
            `Backup artifact could not be read (${error instanceof Error ? error.message : String(error)}). It is NOT verified.`,
          );
        }

        const recorded = backup?.checksum ?? null;
        const matches = recorded ? recorded === digest : null;
        await ctx.progress(80, `sha256 ${digest.slice(0, 16)}… ${matches === null ? "(no recorded checksum to compare)" : matches ? "matches" : "DOES NOT match"}`);

        if (backup) {
          await db.backup
            .update({ where: { id: backup.id }, data: { checksum: digest, status: matches === false ? "FAILED" : "COMPLETED", fileSize: BigInt(sizeBytes) } })
            .catch(() => {});
        }
        if (matches === false) {
          return fail("CHECKSUM_MISMATCH", `Stored checksum does not match the artifact (computed ${digest.slice(0, 16)}…). Treat this backup as unusable.`, {
            data: { digest, recorded, sizeBytes },
          });
        }
        return ok(
          { path: redact(target), digest, sizeBytes, recordedChecksum: recorded, compared: matches !== null },
          `Backup integrity verified: sha256 ${digest.slice(0, 16)}… over ${sizeBytes} byte(s)${matches ? ", matching the stored checksum" : ""}`,
          { evidence: `sha256=${digest}; bytes=${sizeBytes}` },
        );
      }

      if (input.action === "snapshot-record") {
        const id = randomUUID();
        await ctx.progress(50, "recording backup metadata");
        return unverified(
          { snapshotId: id, note: "metadata record only" },
          `Snapshot record ${id} is metadata only. No artifact was produced; schedule PLATFORM_OPS backup-site to create and verify a real backup.`,
        );
      }

      // restore-drill
      const online = await ctx.onlineAgents();
      if (online.length === 0) {
        throw new WorkerError(
          "AGENT_UNAVAILABLE",
          "A restore drill must run in an isolated environment on a managed host, and no server agent has reported a heartbeat recently. No restore was attempted and none is claimed.",
        );
      }
      throw new WorkerError(
        "NOT_IMPLEMENTED",
        "Restore drills need the isolated target host to be configured (RESTORE_DRILL_HOST). Refusing to report a successful restore that did not happen.",
        false,
      );
    },
  }),
);

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// Central platform handlers reuse this registry and the same job lifecycle.
import { platformWorker, workflowStepWorker, aiDiagnosisWorker } from "./platform-workers";
registerWorker(platformWorker);
registerWorker(workflowStepWorker);
registerWorker(aiDiagnosisWorker);

export type { WorkerDefinition };
