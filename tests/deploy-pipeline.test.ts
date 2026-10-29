/**
 * Deployment pipeline safety.
 *
 * The Gate A review found that merging to `main` triggered an unattended
 * production deployment which rebuilt on the host, applied migrations
 * unconditionally (including a table rebuild), health-checked only that an
 * endpoint answered, and had no rollback — while the CI-built artifact it
 * uploaded was never used.
 *
 * These tests pin the replacement behaviour:
 *   - the deployment shape is decided from read-only host facts by pure,
 *     unit-tested logic, and can refuse to deploy at all;
 *   - a release carries an identity record, and the health endpoint reports the
 *     commit that is actually serving;
 *   - the workflow gates the only mutating job behind the `production`
 *     environment and a global single-flight group, runs a read-only preflight
 *     first, verifies the artifact digest, and delegates every decision to a
 *     versioned script instead of inline YAML;
 *   - a deployment never applies a table-rebuild migration.
 *
 * The workflow assertions parse the real YAML, so a future edit that re-adds an
 * inline `pm2 restart` or an unguarded migration fails here rather than in
 * production.
 */
import { teardownIsolatedDb } from "./helpers/isolated-db";
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { load as loadYaml } from "js-yaml";
import {
  decideReleaseTarget,
  validCommitSha,
  type PreflightFacts,
} from "@/lib/deploy/preflight";
import {
  RELEASE_IDENTITY_FILE,
  readReleaseIdentity,
  releaseIdentityPath,
  writeReleaseIdentity,
} from "@/lib/release-identity";

const REPO = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");

const FULL_SHA = "a".repeat(40);

/** Every canonical prerequisite present, every inline prerequisite present. */
const healthyFacts: PreflightFacts = {
  commitSha: FULL_SHA,
  artifactUsable: true,
  envFileReadable: true,
  dbFilePresent: true,
  releasesDirWritable: true,
  systemdUnitPresent: true,
  canonicalRootPresent: true,
  inlineRootIsGit: true,
  inlineRootClean: true,
  pm2Present: true,
};

const without = (...keys: Array<keyof PreflightFacts>): PreflightFacts => {
  const facts = { ...healthyFacts };
  for (const key of keys) (facts as Record<string, unknown>)[key] = false;
  return facts;
};

// ─── The deployment target decision ──────────────────────────────────────────

describe("deployment shape decision", () => {
  it("prefers promoting the CI artifact into an immutable release when the host supports it", () => {
    const decision = decideReleaseTarget(healthyFacts);
    expect(decision.mode).toBe("canonical");
    expect(decision.ok).toBe(true);
    expect(decision.missing).toEqual([]);
    expect(decision.reason).toContain("immutable release");
  });

  it("falls back to the hardened in-place path, naming every canonical prerequisite that is missing", () => {
    const decision = decideReleaseTarget(
      without("envFileReadable", "dbFilePresent", "systemdUnitPresent", "canonicalRootPresent", "releasesDirWritable"),
    );
    expect(decision.mode).toBe("inline");
    expect(decision.ok).toBe(true);
    expect(decision.canonicalBlockedBy.length).toBe(5);
    expect(decision.canonicalBlockedBy.join(" ")).toContain("/etc/alo-hosting/panel.env");
    expect(decision.reason).toContain("additive-only migration");
    expect(decision.reason).toContain("automatic restore");
  });

  it("blocks entirely when the inline checkout has local changes that a pull could overwrite", () => {
    const decision = decideReleaseTarget(without("inlineRootClean", "envFileReadable", "canonicalRootPresent", "dbFilePresent", "systemdUnitPresent", "releasesDirWritable", "artifactUsable"));
    expect(decision.mode).toBe("blocked");
    expect(decision.ok).toBe(false);
    expect(decision.missing.join(" ")).toContain("local changes");
    expect(decision.reason).toContain("Nothing was changed");
  });

  it("blocks when neither shape is available, instead of picking the lesser risk silently", () => {
    const decision = decideReleaseTarget(without("artifactUsable", "envFileReadable", "dbFilePresent", "releasesDirWritable", "systemdUnitPresent", "canonicalRootPresent", "pm2Present"));
    expect(decision.mode).toBe("blocked");
    expect(decision.ok).toBe(false);
    expect(decision.missing.length).toBeGreaterThanOrEqual(7);
    expect(decision.reason).toContain("server-doctor.sh");
  });

  it("refuses to deploy a commit it cannot identify", () => {
    for (const sha of ["", "abc123", "A".repeat(40), `${FULL_SHA}extra`, "not-a-sha"]) {
      const decision = decideReleaseTarget({ ...healthyFacts, commitSha: sha });
      expect(decision.mode, `sha=${sha || "<empty>"}`).toBe("blocked");
      expect(decision.ok).toBe(false);
      expect(decision.missing.join(" ")).toContain("40-character Git SHA");
    }
    expect(validCommitSha(` ${FULL_SHA} `)).toBe(FULL_SHA);
    expect(validCommitSha("abc")).toBeNull();
    expect(validCommitSha(undefined)).toBeNull();
  });

  it("keeps the shell preflight and the tested decision function in agreement", () => {
    const facts = without("envFileReadable", "dbFilePresent", "systemdUnitPresent", "canonicalRootPresent", "releasesDirWritable");
    const expected = decideReleaseTarget(facts);
    const out = execFileSync(process.execPath, [path.join(REPO, "scripts/decide-release-target.mjs")], {
      input: JSON.stringify(facts),
      encoding: "utf8",
    });
    expect(JSON.parse(out)).toEqual(expected);
  });

  it("runs the read-only preflight script against this sandbox and reports the truth about it", () => {
    // This sandbox has no systemd unit, no pm2 and no /etc/alo-hosting, so the
    // honest answer is "blocked". What matters is that it answers, exits
    // non-zero, and changes nothing.
    const before = fs.readdirSync(REPO).sort();
    let status = 0;
    let output = "";
    try {
      output = execFileSync("bash", [path.join(REPO, "scripts/deploy-preflight.sh"), "--json"], {
        cwd: REPO,
        encoding: "utf8",
        env: { ...process.env, DEPLOY_COMMIT_SHA: FULL_SHA, ALO_INLINE_APP_DIR: REPO },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const e = error as { status?: number; stdout?: string };
      status = e.status ?? 1;
      output = e.stdout ?? "";
    }
    expect(status).not.toBe(0);
    const parsed = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
    expect(parsed.decision.mode).toBe("blocked");
    expect(parsed.facts.commitSha).toBe(FULL_SHA);
    expect(parsed.decision.missing.join(" ")).toContain("pm2");
    expect(fs.readdirSync(REPO).sort()).toEqual(before);
  });
});

// ─── Release identity ────────────────────────────────────────────────────────

describe("release identity", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "alo-release-identity-"));

  it("round-trips a full record and rejects a short or malformed commit SHA", () => {
    const file = writeReleaseIdentity(tmp, {
      commitSha: FULL_SHA,
      mode: "inline",
      artifactSha256: "deadbeef".repeat(8),
      activatedAt: new Date().toISOString(),
    });
    expect(file).toBe(releaseIdentityPath(tmp));
    expect(file.endsWith(RELEASE_IDENTITY_FILE)).toBe(true);

    const readBack = readReleaseIdentity(tmp);
    expect(readBack?.commitSha).toBe(FULL_SHA);
    expect(readBack?.mode).toBe("inline");
    expect(readBack?.artifactSha256).toBe("deadbeef".repeat(8));
    expect(readBack?.deploymentId).toMatch(/^[0-9a-f-]{36}$/);

    expect(() => writeReleaseIdentity(tmp, { commitSha: "abc", mode: "inline", artifactSha256: null, activatedAt: new Date().toISOString() })).toThrow(/40-character/);
  });

  it("reports an absent or corrupt record as unknown rather than guessing a SHA", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "alo-release-none-"));
    expect(readReleaseIdentity(empty)).toBeNull();

    fs.writeFileSync(path.join(empty, RELEASE_IDENTITY_FILE), "{ not json");
    expect(readReleaseIdentity(empty)).toBeNull();

    fs.writeFileSync(path.join(empty, RELEASE_IDENTITY_FILE), JSON.stringify({ commitSha: "short", mode: "inline", activatedAt: new Date().toISOString() }));
    expect(readReleaseIdentity(empty)).toBeNull();

    // A valid SHA but an unknown mode is still not a trustworthy record.
    fs.writeFileSync(path.join(empty, RELEASE_IDENTITY_FILE), JSON.stringify({ commitSha: FULL_SHA, mode: "whatever", activatedAt: new Date().toISOString() }));
    expect(readReleaseIdentity(empty)).toBeNull();

    fs.rmSync(empty, { recursive: true, force: true });
  });

  it("gives every activation a distinct deployment id even for the same commit", () => {
    const a = writeReleaseIdentity(tmp, { commitSha: FULL_SHA, mode: "canonical", artifactSha256: null, activatedAt: new Date().toISOString() });
    const first = readReleaseIdentity(tmp)?.deploymentId;
    writeReleaseIdentity(tmp, { commitSha: FULL_SHA, mode: "canonical", artifactSha256: null, activatedAt: new Date().toISOString() });
    expect(readReleaseIdentity(tmp)?.deploymentId).not.toBe(first);
    expect(a).toBe(releaseIdentityPath(tmp));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

// ─── The health endpoint must identify the running release ───────────────────

describe("GET /api/health", () => {
  it("reports the deployed commit when a release identity exists, and null when it does not", async () => {
    const route = await import("@/app/api/health/route");
    const cwd = process.cwd();

    const unknown = await route.GET();
    const unknownBody = (await unknown.json()) as { data?: { release?: unknown } | null; error?: { details?: { release?: unknown } } };
    // This checkout has no identity file: unknown, not a fabricated SHA.
    expect(unknownBody.data?.release ?? unknownBody.error?.details?.release ?? null).toBeNull();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-health-release-"));
    try {
      writeReleaseIdentity(dir, { commitSha: FULL_SHA, mode: "inline", artifactSha256: null, activatedAt: new Date().toISOString() });
      process.chdir(dir);
      const res = await route.GET();
      const body = (await res.json()) as {
        success: boolean;
        data?: { release?: { commitSha: string; mode: string; deploymentId: string } | null; databaseStatus?: string };
        error?: { details?: { release?: { commitSha: string; mode: string; deploymentId: string }; databaseStatus?: string } };
      };
      // The release identity is reported on both the healthy and the unhealthy
      // path: "which commit answered" must be knowable even when the database
      // probe fails, otherwise a broken release cannot be identified.
      const release = body.data?.release ?? body.error?.details?.release ?? null;
      expect(release?.commitSha).toBe(FULL_SHA);
      expect(release?.mode).toBe("inline");
      expect(release?.deploymentId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      process.chdir(cwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── The workflow itself ─────────────────────────────────────────────────────

interface WorkflowJob {
  name?: string;
  needs?: string | string[];
  if?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  environment?: string | { name: string };
  concurrency?: { group: string; "cancel-in-progress": boolean };
  outputs?: Record<string, string>;
  steps: Array<{ name?: string; uses?: string; run?: string; id?: string; env?: Record<string, string>; with?: Record<string, unknown> }>;
}
interface Workflow {
  on: { push?: { branches?: string[] }; pull_request?: { branches?: string[] } };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean | string };
  jobs: Record<string, WorkflowJob>;
}

const workflow = loadYaml(read(".github/workflows/ci-cd.yml")) as Workflow;
const deployJob = workflow.jobs.deploy;
const preflightJob = workflow.jobs["deploy-preflight"];
const buildJob = workflow.jobs.build;
const allRuns = (job: WorkflowJob) => job.steps.map((s) => s.run ?? "").join("\n");

describe("CI/CD workflow controls", () => {
  it("limits push triggers to the deployment branches", () => {
    expect(workflow.on.push?.branches).toEqual(["main", "develop"]);
    expect(workflow.on.pull_request?.branches).toEqual(["main", "develop"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("gates the only mutating job behind the production environment and a global single flight", () => {
    expect(deployJob.environment).toBe("production");
    expect(deployJob.concurrency?.group).toBe("hosting-production-deploy");
    expect(deployJob.concurrency?.["cancel-in-progress"]).toBe(false);
    // The group must not be per-ref, or two branches could deploy at once.
    expect(deployJob.concurrency?.group).not.toContain("github.ref");
    expect(deployJob["runs-on"]).toBe("self-hosted");
    expect(workflow.concurrency.group).toContain("github.ref"); // CI stays per-ref
  });

  it("can only deploy a merged commit on main, and only after a read-only preflight", () => {
    expect(deployJob.if).toContain("github.event_name == 'push'");
    expect(deployJob.if).toContain("refs/heads/main");
    expect(deployJob.needs).toEqual(["build", "deploy-preflight"]);
    expect(preflightJob.if).toContain("refs/heads/main");
    expect(preflightJob["runs-on"]).toBe("self-hosted");
    expect(buildJob.outputs?.["artifact-digest"]).toContain("steps.digest.outputs.value");
  });

  it("keeps the preflight job read-only: no install, build, migration or restart in the app checkout", () => {
    const runs = allRuns(preflightJob);
    expect(runs).toContain("deploy-preflight.sh");
    expect(runs).toContain("status --porcelain");
    for (const forbidden of ["pm2 restart", "systemctl", "apply-deploy-schema", "npm run build", "git pull", "git checkout main", "git reset"]) {
      expect(runs, `preflight must not run: ${forbidden}`).not.toContain(forbidden);
    }
    // The only npm ci is in the ephemeral workspace, not in $APP_DIR.
    expect(runs).not.toContain("cd \"$APP_DIR\"");
  });

  it("verifies the artifact digest in the build, in the preflight and again on the deploying runner", () => {
    expect(allRuns(buildJob)).toContain(".deploy-digest");
    expect(allRuns(preflightJob)).toContain("artifact digest mismatch");
    expect(allRuns(deployJob)).toContain("artifact digest mismatch");
    const uploaded = buildJob.steps.find((s) => s.uses?.startsWith("actions/upload-artifact"))?.with as unknown as {
      path: string;
      "include-hidden-files"?: boolean;
    };
    expect(uploaded.path).toContain(".deploy-digest");
    expect(uploaded.path).toContain(".next/standalone");
    // Without include-hidden-files: true, actions/upload-artifact@v4 drops
    // .deploy-digest and hidden .next/.prisma directories inside standalone.
    expect(uploaded["include-hidden-files"]).toBe(true);
    expect(preflightJob["timeout-minutes"]).toBeGreaterThanOrEqual(15);
    expect(deployJob["timeout-minutes"]).toBeGreaterThanOrEqual(20);
  });

  it("delegates every deployment decision to a versioned script instead of inline YAML", () => {
    const runs = allRuns(deployJob);
    expect(runs).toContain("bash scripts/deploy-release.sh");
    // The hand-rolled inline deployment is gone: no direct pm2, build, pull or
    // migration inside the workflow.
    for (const forbidden of ["pm2 restart", "pm2 save", "npm run build", "git pull", "node scripts/apply-deploy-schema.mjs", "curl -sf http://127.0.0.1:3051/api/health"]) {
      expect(runs, `deploy job must not contain: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("passes the intended commit SHA to the release script", () => {
    const step = deployJob.steps.find((s) => s.name?.startsWith("Activate the release"));
    expect(step?.env?.DEPLOY_COMMIT_SHA).toBe("${{ github.sha }}");
    expect(step?.env?.DEPLOY_PAYLOAD_DIR).toContain(".deploy-artifact");
    expect(step?.env?.DEPLOY_MODE).toContain("needs.deploy-preflight.outputs.mode");
  });
});

// ─── The release scripts ─────────────────────────────────────────────────────

describe("deployment scripts", () => {
  const releaseScript = read("scripts/deploy-release.sh");
  const canonicalScript = read("scripts/deploy-production.sh");
  const applier = read("scripts/apply-deploy-schema.mjs");

  it("all parse as valid bash", () => {
    for (const script of ["scripts/deploy-release.sh", "scripts/deploy-production.sh", "scripts/deploy-preflight.sh", "scripts/backup.sh", "scripts/rollback.sh"]) {
      expect(() => execFileSync("bash", ["-n", path.join(REPO, script)], { encoding: "utf8" }), script).not.toThrow();
    }
  });

  it("never applies a table-rebuild migration during a deployment", () => {
    // Comments may *mention* the flag while explaining that a human must run it;
    // what matters is that no executable line passes it.
    const code = (script: string) =>
      script
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .join("\n");
    expect(releaseScript).toContain("apply-deploy-schema.mjs");
    expect(code(releaseScript)).not.toContain("--allow-rebuild");
    expect(code(canonicalScript)).not.toContain("--allow-rebuild");
    expect(code(allRuns(deployJob))).not.toContain("--allow-rebuild");
    expect(releaseScript).toContain("additive-only");
    expect(releaseScript).toContain("ADDITIVE migrations only");
    // And the script says so where an operator will read it.
    expect(releaseScript).toContain("rebuild migrations require a separate authorized run");
  });

  it("requires an explicit absolute database target outside the checkout", () => {
    expect(releaseScript).toContain('[[ "$DB_URL" == file:/* ]]');
    expect(releaseScript).toContain("the production database is inside the Git checkout");
    expect(releaseScript).toContain("a checkout reset would destroy live data");
    expect(releaseScript).toContain("ALLOW_DB_IN_CHECKOUT");
    // And the applier itself refuses to guess.
    expect(applier).toContain("no longer falls back to file:./db/custom.db");
    expect(applier).not.toMatch(/process\.env\.DATABASE_URL \|\| "file:/);
  });

  it("captures the previous state before changing anything, and restores it on failure", () => {
    expect(releaseScript).toContain("PREV_SHA=");
    expect(releaseScript).toContain("restore()");
    expect(releaseScript).toContain("git reset --hard \"$PREV_SHA\"");
    expect(releaseScript).toContain("database-$(date -u");
    expect(releaseScript).toContain("trap 'code=$?");
    expect(canonicalScript).toContain("restoring previous release");
    expect(canonicalScript).toContain("mv -Tf \"$rollback_link\" \"$CURRENT\"");
  });

  it("refuses stale queued runs and backwards releases unless rollback is explicitly authorized", () => {
    expect(releaseScript).toContain('LATEST_MAIN_SHA="$(git rev-parse origin/main)"');
    expect(releaseScript).toContain('[[ "$SHA" == "$LATEST_MAIN_SHA" ]]');
    expect(releaseScript).toContain('git merge-base --is-ancestor "$PREV_SHA" "$SHA"');
    expect(releaseScript).toContain("ALLOW_RELEASE_ROLLBACK");
    expect(releaseScript).toContain("refusing backwards deployment");
    expect(releaseScript).toContain('git merge-base --is-ancestor "$SHA" origin/main');
    expect(releaseScript).toContain("refusing to deploy something that was not merged");
  });

  it("ignores the runtime release identity so inline deploys do not dirty the checkout", () => {
    expect(read(".gitignore")).toMatch(/^release-identity\.json$/m);
  });

  it("proves the running application reports the deployed commit, not merely that it answers", () => {
    expect(releaseScript).toContain("verify_health");
    expect(releaseScript).toContain("d.release.commitSha");
    expect(releaseScript).toContain("did not confirm release");
    expect(canonicalScript).toContain("EXPECT_SHA=\"$SHA\"");
    expect(canonicalScript).toContain("data.release.commitSha === process.env.EXPECT_SHA");
    expect(canonicalScript).toContain("release-identity.json");
    // The old check accepted any 200 from /api/health.
    expect(canonicalScript).not.toContain('curl -sf http://127.0.0.1:3051/api/health && echo "Deploy OK"');
  });

  it("writes the release identity before the process is restarted, so the probe can see it", () => {
    const identityAt = releaseScript.indexOf("recorded release identity");
    const restartAt = releaseScript.lastIndexOf("\nrestart_panel\n");
    expect(identityAt).toBeGreaterThan(0);
    expect(restartAt).toBeGreaterThan(identityAt);
  });

  it("keeps an evidence log for every release", () => {
    expect(releaseScript).toContain("ALO_DEPLOY_LOG_DIR");
    expect(releaseScript).toContain("RUN_LOG=");
    expect(releaseScript).toContain("tee -a \"$RUN_LOG\"");
  });

  it("never prints a secret or a database URL value", () => {
    for (const script of [releaseScript, canonicalScript, read("scripts/deploy-preflight.sh"), applier]) {
      expect(script).not.toMatch(/echo\s+"\$DB_URL"/);
      expect(script).not.toMatch(/echo\s+"\$\{?DATABASE_URL/);
      expect(script).not.toContain("cat /etc/alo-hosting/panel.env");
    }
    expect(releaseScript).toContain("value not printed");
  });
});

/** Delete this file's scratch database copy. */
afterAll(async () => {
  await teardownIsolatedDb();
});
