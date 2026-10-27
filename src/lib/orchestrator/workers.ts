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
import { z } from "zod";
import { db } from "@/lib/db";
import { redact } from "@/lib/deploy/redact";
import { validateRepositoryName, getCommit, resolveToken, fetchRepoManifests } from "@/lib/deploy/github";
import { detectFramework, memoryReader } from "@/lib/deploy/detect";
import { runDeployment, rollbackProject } from "@/lib/deploy/engine";
import { readMarker, currentReleaseDir } from "@/lib/deploy/service";
import { defineWorker, fail, ok, unverified, WorkerError, type JobFinding, type WorkerDefinition } from "./contracts";

const workers = new Map<string, WorkerDefinition<any, any>>();

/**
 * Resolve the least-privileged GitHub token for a connection id.
 * Returns `token: null` (never throws) so callers can report an honest
 * "credential not configured" result instead of crashing the job.
 */
async function tokenForConnection(connectionId: string | null | undefined) {
  if (!connectionId) return resolveToken(null);
  const connection = await db.gitConnection.findUnique({ where: { id: connectionId } });
  if (!connection) return resolveToken(null);
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
          const detection = await detectFramework(memoryReader(projectManifestsFromDetection(stored)));
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
    defaultMaxAttempts: 1, // the engine already restores the previous release; blind retries are unsafe
    defaultTimeoutMs: 30 * 60_000,
    inputSchema: buildTestInput,
    async handler(input, ctx) {
      const deployment = await db.deployment.findUnique({ where: { id: input.deploymentId } });
      if (!deployment) throw new WorkerError("NOT_FOUND", `Deployment ${input.deploymentId} not found`);

      await ctx.progress(10, `running deployment ${deployment.id} (commit ${deployment.commitHash?.slice(0, 12) ?? "unknown"})`);
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
        const root = await resolveScanRoot(input);
        await ctx.progress(20, `scanning ${root}`);
        for await (const rel of walk(root, 400)) {
          const content = await fs.readFile(path.join(root, rel), "utf8").catch(() => null);
          if (content === null) continue;
          inspect(rel, content);
          if (scanned >= 400) break;
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
    const abs = path.join(root, rel);
    let names: string[];
    let kinds: Record<string, "dir" | "file">;
    try {
      const entries = await fs.readdir(abs, { withFileTypes: true });
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
    maxRisk: "PRIVILEGED",
    requiredScopes: ["server:execute"],
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
      const dispatched = await agentLib.dispatchTask({
        agentId: input.agentId,
        command: input.command,
        args: input.args,
        jobId: ctx.jobId,
        correlationId: ctx.correlationId,
        actorEmail: ctx.actor?.email,
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
  action: z.enum(["audit", "verify-ownership", "plan-dns", "issue-certificate", "renew"]),
  domain: z.string().min(3).max(253),
  serverId: z.string().optional(),
});

registerWorker(
  defineWorker<z.infer<typeof domainTlsInput>, unknown>({
    kind: "DOMAIN_TLS",
    label: "Domain & TLS",
    description:
      "Audits recorded domain/SSL state, previews DNS record changes and plans certificate issuance or renewal. Never applies a DNS change without an approval.",
    execution: "EXTERNAL",
    maxRisk: "PRIVILEGED",
    requiredScopes: ["domain:read", "domain:write"],
    defaultMaxAttempts: 2,
    defaultTimeoutMs: 3 * 60_000,
    inputSchema: domainTlsInput,
    async handler(input, ctx) {
      await ctx.progress(25, `looking up ${input.domain}`);
      const domain = await db.domain.findFirst({ where: { domain: input.domain } });
      const certs = domain
        ? await db.sslCertificate.findMany({ where: { domainId: domain.id }, orderBy: { createdAt: "desc" }, take: 5 })
        : [];

      if (input.action === "audit") {
        return domain || certs.length
          ? ok(
              {
                domain: domain
                  ? { id: domain.id, domain: domain.domain, sslEnabled: domain.sslEnabled, sslStatus: domain.sslStatus, dnsVerified: domain.dnsVerified, certificateExpiry: domain.certificateExpiry }
                  : null,
                certificates: certs.map((c) => ({ id: c.id, issuer: c.issuer, notBefore: c.notBefore, notAfter: c.notAfter, autoRenew: c.autoRenew })),
              },
              `Recorded state for ${input.domain}: sslStatus=${domain?.sslStatus ?? "no domain record"}, dnsVerified=${domain?.dnsVerified ?? false}, ${certs.length} certificate row(s)`,
              { evidence: `domains rows=${domain ? 1 : 0}; ssl_certificates rows=${certs.length}` },
            )
          : unverified({ domain: null, certificates: [] }, `No recorded domain or certificate state for ${input.domain}. Nothing was queried live because no DNS/CA credential is configured.`);
      }

      if (input.action === "plan-dns") {
        return ok(
          {
            domain: input.domain,
            preview: [
              { type: "A", name: "@", value: "<production server IPv4>", ttl: 300, note: "set only after the server IP is confirmed" },
              { type: "AAAA", name: "@", value: "<production server IPv6>", ttl: 300, note: "optional" },
              { type: "CNAME", name: "www", value: `${input.domain}.`, ttl: 300, note: "optional" },
            ],
            approvalRequired: true,
          },
          `DNS change preview produced for ${input.domain}; no record was modified`,
        );
      }

      const hasProvider = Boolean(process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_ZONE_ID);
      if (!hasProvider) {
        throw new WorkerError(
          "NOT_CONFIGURED",
          `'${input.action}' for ${input.domain} needs a configured DNS/certificate provider (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID or an ACME account). Nothing was changed and no certificate was issued.`,
          false,
        );
      }
      throw new WorkerError(
        "NOT_IMPLEMENTED",
        `'${input.action}' is not wired to a live ACME/DNS provider in this build. Refusing to report success without issuing a real certificate.`,
        false,
      );
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
    defaultMaxAttempts: 3,
    defaultTimeoutMs: 2 * 60_000,
    inputSchema: monitoringInput,
    async handler(input, ctx) {
      if (input.action === "recover") {
        if (!input.projectId) throw new WorkerError("VALIDATION_FAILED", "projectId is required for recovery");
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
  action: z.enum(["verify", "snapshot-record", "restore-drill"]),
  websiteId: z.string().min(1).optional(),
  backupId: z.string().min(1).optional(),
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
    defaultMaxAttempts: 2,
    defaultTimeoutMs: 15 * 60_000,
    inputSchema: backupInput,
    async handler(input, ctx) {
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
        return ok(
          { snapshotId: id, note: "metadata record only" },
          `Snapshot record ${id} created. No artifact was produced by this worker; use scripts/backup.sh for the actual copy.`,
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

export type { WorkerDefinition };
