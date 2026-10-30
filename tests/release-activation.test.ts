/**
 * Release activation safety.
 *
 * These tests reproduce the failures that stopped every production deployment
 * between runs #54 and #64, and the two hazards that were latent behind them.
 *
 * 1. THE DEADLOCK. `scripts/deploy-release.sh` writes `release-identity.json`
 *    into the production Git checkout so the running app can report its commit
 *    through `/api/health`. The preflight dirty-tree check counted untracked
 *    files, so the first successful inline deploy blocked every deploy after it
 *    with "Production checkout has local changes" — and the host could not pull
 *    the commit that would have ignored the file, because that pull was exactly
 *    what was blocked. Verified against the annotation on run #64 job
 *    123187249221 and run #54 job 123149167333.
 *
 * 2. THE BACKWARDS RELEASE. Merge-to-main runs are serialized by the workflow's
 *    `hosting-production-deploy` concurrency group and are never cancelled, so an
 *    obsolete run waits its turn and then deploys. Commit `123d558` (run #62) is
 *    a direct ancestor of `7fc3d15` (run #64) — confirmed by the compare API,
 *    `ahead_by: 2, behind_by: 0`. Run #62 waited two hours in that queue. Only
 *    the unrelated dirty-checkout failure stopped it from resetting production
 *    backwards, passing its own health check, and reporting success while
 *    reverting two commits of deploy and agent fixes.
 *
 * 3. THE VACUOUS GUARD. PR #18 compared the target against
 *    `git rev-parse origin/main`. Actions checks out with `fetch-depth: 1`, and
 *    `git fetch origin main` in a shallow clone leaves `origin/main` at the run's
 *    own commit, so that comparison is true for precisely the stale run it exists
 *    to reject. The head of main is now resolved independently of the clone.
 *
 * The checkout tests are behavioural: they build real temporary Git repositories
 * in the states production was actually in, run the real script, and assert on
 * its exit code and output. Asserting on source text would have passed for the
 * deadlocking version too.
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { load as loadYaml } from "js-yaml";
import {
  decideReleaseActivation,
  rollbackAuditRecord,
  type ReleaseActivationFacts,
} from "@/lib/deploy/release-guard";

const REPO = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");
const CLASSIFIER = path.join(REPO, "scripts/host-checkout-status.sh");
const GUARD_CLI = path.join(REPO, "scripts/decide-release-activation.mjs");
const LATEST_MAIN = path.join(REPO, "scripts/latest-main-sha.mjs");

const TARGET = "a".repeat(40);
const RUNNING_NEWER = "b".repeat(40);
const MAIN_HEAD = "c".repeat(40);

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** A real Git repository with one commit, in a real temporary directory. */
function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-checkout-"));
  tempDirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  git("init", "-q", "-b", "main", ".");
  git("config", "user.email", "deploy-test@example.invalid");
  git("config", "user.name", "deploy-test");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"canonical-root"}\n');
  fs.writeFileSync(path.join(dir, "package-lock.json"), '{"lockfileVersion":3}\n');
  git("add", "-A");
  git("commit", "-qm", "initial production state");
  return dir;
}

/** The record `scripts/deploy-release.sh` writes after a successful deployment. */
const IDENTITY = JSON.stringify({
  commitSha: RUNNING_NEWER,
  mode: "inline",
  artifactSha256: null,
  activatedAt: "2026-10-29T00:37:39Z",
  deploymentId: "77399a99-a38b-406b-be83-6ced313c0fbe",
});

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function classify(dir: string, json = false): RunResult {
  const args = [CLASSIFIER, dir];
  if (json) args.push("--json");
  try {
    const stdout = execFileSync("bash", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// ─── 1. The dirty-checkout deadlock ──────────────────────────────────────────

describe("production checkout classification (runs #54–#64 blocker)", () => {
  it("allows a clean checkout", () => {
    const dir = makeRepo();
    const result = classify(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("safe to deploy");
  });

  it("no longer blocks on the release identity the deployment itself wrote", () => {
    // This is the exact state production was in for runs #54, #58, #60, #62, #64.
    // The old check was `[[ -n "$(git status --porcelain --untracked-files=normal)" ]]`
    // and it failed here, permanently: the file could only be removed by a
    // deployment that this file was preventing.
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, "release-identity.json"), IDENTITY);

    expect(classify(dir).status).toBe(0);

    const json = classify(dir, true);
    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      safe: true,
      tolerated: ["release-identity.json"],
      blocking: [],
    });
  });

  it("still blocks genuine uncommitted work, and names it", () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, "release-identity.json"), IDENTITY);
    fs.writeFileSync(path.join(dir, "uncommitted-hotfix.ts"), "export const x = 1;\n");

    const result = classify(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("uncommitted-hotfix.ts");
    expect(result.stderr).toContain("NOT safe to deploy");

    const json = JSON.parse(classify(dir, true).stdout);
    expect(json.safe).toBe(false);
    expect(json.blocking).toContain("untracked: uncommitted-hotfix.ts");
    // The tolerated file is reported separately, so an operator can see that the
    // block is about their hotfix and not about deployment output.
    expect(json.tolerated).toContain("release-identity.json");
  });

  it("blocks a modified tracked file even when it has a tolerated name", () => {
    // Tolerance is for untracked deployment output only. A tracked file that
    // changed is source that a pull would overwrite.
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, "release-identity.json"), IDENTITY);
    execFileSync("git", ["add", "release-identity.json"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["commit", "-qm", "track it"], { cwd: dir, stdio: "ignore" });
    fs.writeFileSync(path.join(dir, "release-identity.json"), '{"commitSha":"tampered"}');

    const result = classify(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/modified|staged/);
  });

  it("blocks a staged change, because someone prepared a commit on the host", () => {
    const dir = makeRepo();
    fs.appendFileSync(path.join(dir, "package.json"), "// staged on production\n");
    execFileSync("git", ["add", "package.json"], { cwd: dir, stdio: "ignore" });

    const result = classify(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("staged");
  });

  it("validates the content of a tolerated file, so the allowlist cannot be abused", () => {
    // A familiar filename is not evidence. Anything that is not a well-formed
    // release identity record blocks, which is what stops the allowlist becoming
    // a way to smuggle an arbitrary payload past the safety check.
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, "release-identity.json"), "rm -rf / --no-preserve-root\n");
    expect(classify(dir).status).toBe(1);

    fs.writeFileSync(path.join(dir, "release-identity.json"), '{"commitSha":"not-a-sha"}');
    expect(classify(dir).status).toBe(1);

    fs.writeFileSync(path.join(dir, "release-identity.json"), "{}");
    expect(classify(dir).status).toBe(1);

    fs.writeFileSync(path.join(dir, "release-identity.json"), IDENTITY);
    expect(classify(dir).status).toBe(0);
  });

  it("survives paths containing spaces", () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, "operator notes.txt"), "handwritten\n");
    const json = JSON.parse(classify(dir, true).stdout);
    expect(json.safe).toBe(false);
    expect(json.blocking).toContain("untracked: operator notes.txt");
  });

  it("reports a usable error, not a crash, when the directory is not a work tree", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-not-git-"));
    tempDirs.push(dir);
    const result = classify(dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not a Git work tree");
  });

  it("is read-only: it never cleans, stashes, resets or writes", () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, "release-identity.json"), IDENTITY);
    fs.writeFileSync(path.join(dir, "keep-me.txt"), "must survive\n");
    const before = fs.readdirSync(dir).sort();

    classify(dir);

    expect(fs.readdirSync(dir).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(dir, "keep-me.txt"), "utf8")).toBe("must survive\n");
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    expect(status).toContain("keep-me.txt");
  });

  it("is what the preflight script and the workflow now delegate to", () => {
    expect(read("scripts/deploy-preflight.sh")).toContain("host-checkout-status.sh");
    const workflow = read(".github/workflows/ci-cd.yml");
    expect(workflow).toContain("bash scripts/host-checkout-status.sh \"$APP_DIR\"");
    // The duplicated bare git-status test is gone: two copies of a rule drift,
    // and the copy in YAML was the one that could not be unit-tested.
    expect(workflow).not.toContain('git -C "$APP_DIR" status --porcelain --untracked-files=normal');
  });
});

// ─── 2. The release activation guard ─────────────────────────────────────────

const facts = (overrides: Partial<ReleaseActivationFacts> = {}): ReleaseActivationFacts => ({
  targetSha: MAIN_HEAD,
  latestMainSha: MAIN_HEAD,
  runningSha: RUNNING_NEWER,
  targetOnMain: true,
  runningIsAncestorOfTarget: true,
  targetIsAncestorOfRunning: false,
  ...overrides,
});

const authorizedRollback = {
  allowRollback: true,
  operator: "ops@example.invalid",
  reason: "release b… reverted",
};

describe("release activation guard", () => {
  it("authorizes a forward release that is main's current head", () => {
    const decision = decideReleaseActivation(facts());
    expect(decision).toMatchObject({ authorized: true, code: "authorize", rollback: false });
    expect(decision.evidence).toEqual({
      targetSha: MAIN_HEAD,
      latestMainSha: MAIN_HEAD,
      runningSha: RUNNING_NEWER,
    });
  });

  it("refuses the obsolete queued run that caused the backwards-release hazard", () => {
    // Run #62 carrying 123d558 after main had moved to 7fc3d15.
    const decision = decideReleaseActivation(
      facts({
        targetSha: RUNNING_NEWER,
        latestMainSha: MAIN_HEAD,
        runningSha: null,
        runningIsAncestorOfTarget: false,
        targetIsAncestorOfRunning: false,
      }),
    );
    expect(decision).toMatchObject({ authorized: false, code: "stale-target", rollback: false });
    expect(decision.reason).toContain(RUNNING_NEWER);
    expect(decision.reason).toContain(MAIN_HEAD);
  });

  it("refuses to move production backwards when nobody asked for a rollback", () => {
    const decision = decideReleaseActivation(
      facts({
        targetSha: RUNNING_NEWER,
        latestMainSha: RUNNING_NEWER,
        runningSha: MAIN_HEAD,
        runningIsAncestorOfTarget: false,
        targetIsAncestorOfRunning: true,
      }),
    );
    expect(decision).toMatchObject({ authorized: false, code: "backward-release", rollback: true });
    expect(decision.reason).toContain("ALLOW_RELEASE_ROLLBACK=1");
    // It has to say why a rollback is dangerous, not just that it is refused:
    // additive migrations from the newer release are not guaranteed reversible.
    expect(decision.reason).toContain("not guaranteed to be reversible");
  });

  it("permits an authorized rollback, and only when it is attributed", () => {
    const backwards = facts({
      targetSha: RUNNING_NEWER,
      latestMainSha: MAIN_HEAD,
      runningSha: MAIN_HEAD,
      runningIsAncestorOfTarget: false,
      targetIsAncestorOfRunning: true,
    });

    const bare = decideReleaseActivation(backwards, { allowRollback: true });
    expect(bare).toMatchObject({ authorized: false, code: "unattributed-rollback", rollback: true });

    const partial = decideReleaseActivation(backwards, {
      allowRollback: true,
      operator: "   ",
      reason: "because",
    });
    expect(partial.code).toBe("unattributed-rollback");

    const attributed = decideReleaseActivation(backwards, authorizedRollback);
    expect(attributed).toMatchObject({ authorized: true, rollback: true });
    expect(attributed.reason).toContain(authorizedRollback.operator);
    expect(attributed.reason).toContain(authorizedRollback.reason);
    // It has to warn that a rollback is not a database undo.
    expect(attributed.reason).toContain("Additive migrations");
    expect(attributed.reason).toContain("NOT reversed");
  });

  it("still requires a rollback target to be merged into main", () => {
    // Authorization to go backwards is not authorization to deploy unreviewed
    // code. Without this, the flag would be a way to ship anything.
    const decision = decideReleaseActivation(
      facts({
        targetSha: RUNNING_NEWER,
        runningSha: MAIN_HEAD,
        targetOnMain: false,
        runningIsAncestorOfTarget: false,
        targetIsAncestorOfRunning: true,
      }),
      authorizedRollback,
    );
    expect(decision).toMatchObject({ authorized: false, code: "unmerged-target" });
  });

  it("treats re-activating the running release as an idempotent retry", () => {
    const decision = decideReleaseActivation(
      facts({ targetSha: RUNNING_NEWER, latestMainSha: RUNNING_NEWER, runningSha: RUNNING_NEWER }),
    );
    expect(decision).toMatchObject({ authorized: true, code: "already-running", rollback: false });
  });

  it("treats a host with no recorded release as a first deployment, not a rollback", () => {
    // Blocking this would make a fresh host undeployable: there is nothing to be
    // backwards from, and no way to set a rollback flag for a first release.
    const decision = decideReleaseActivation(facts({ runningSha: null, runningIsAncestorOfTarget: false }));
    expect(decision).toMatchObject({ authorized: true, rollback: false });
    expect(decision.reason).toContain("first deployment");
  });

  it("fails closed when main's head cannot be resolved", () => {
    // "Probably current" is not a fact a production release should rest on.
    const decision = decideReleaseActivation(facts({ latestMainSha: null }));
    expect(decision).toMatchObject({ authorized: false, code: "unknown-main-head" });
  });

  it("rejects a malformed target SHA instead of deploying an unidentifiable release", () => {
    for (const bad of ["", "deadbeef", "A".repeat(40), "z".repeat(40), MAIN_HEAD.slice(0, 39)]) {
      expect(decideReleaseActivation(facts({ targetSha: bad })).authorized).toBe(false);
    }
  });

  it("writes an audit record that answers who, from what, to what, and why", () => {
    const decision = decideReleaseActivation(
      facts({
        targetSha: RUNNING_NEWER,
        latestMainSha: MAIN_HEAD,
        runningSha: MAIN_HEAD,
        runningIsAncestorOfTarget: false,
        targetIsAncestorOfRunning: true,
      }),
      authorizedRollback,
    );
    const record = rollbackAuditRecord({
      operator: authorizedRollback.operator,
      reason: authorizedRollback.reason,
      decision,
      deploymentId: "dep-1",
      recordedAt: "2026-10-29T01:00:00Z",
    });
    expect(record).toEqual({
      event: "release-rollback",
      recordedAt: "2026-10-29T01:00:00Z",
      operator: "ops@example.invalid",
      reason: authorizedRollback.reason,
      sourceRelease: MAIN_HEAD,
      targetRelease: RUNNING_NEWER,
      mainHeadAtDecision: MAIN_HEAD,
      deploymentId: "dep-1",
      result: "authorized",
    });
  });
});

// ─── 3. The bash ↔ TypeScript bridge ─────────────────────────────────────────

describe("release guard CLI bridge", () => {
  function decide(input: unknown): RunResult {
    try {
      const stdout = execFileSync(process.execPath, [GUARD_CLI], {
        input: JSON.stringify(input),
        encoding: "utf8",
        cwd: REPO,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  it("agrees with the tested decision function", () => {
    const input = { facts: facts(), authorization: { allowRollback: false } };
    const result = decide(input);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(decideReleaseActivation(facts(), { allowRollback: false }));
  });

  it("exits non-zero for a refused release, so bash fails closed", () => {
    const stale = facts({
      targetSha: RUNNING_NEWER,
      latestMainSha: MAIN_HEAD,
      runningSha: null,
      runningIsAncestorOfTarget: false,
    });
    const result = decide({ facts: stale, authorization: { allowRollback: false } });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).code).toBe("stale-target");
  });

  it("exits 2 and says so when the facts are not JSON", () => {
    try {
      execFileSync(process.execPath, [GUARD_CLI], {
        input: "not json",
        encoding: "utf8",
        cwd: REPO,
        stdio: ["pipe", "pipe", "pipe"],
      });
      throw new Error("expected a non-zero exit");
    } catch (error) {
      const e = error as { status?: number; stderr?: string };
      expect(e.status).toBe(2);
      expect(e.stderr).toContain("not valid JSON");
    }
  });
});

describe("resolving the head of main", () => {
  it("fails closed rather than printing a guess", () => {
    // No usable remote and a repository that does not exist: the script must
    // exit non-zero and print nothing on stdout, so the caller treats the head
    // as unknown and refuses to deploy.
    let status = 0;
    let stdout = "";
    let stderr = "";
    try {
      stdout = execFileSync(process.execPath, [LATEST_MAIN, "--ref", "main"], {
        encoding: "utf8",
        cwd: os.tmpdir(),
        env: { ...process.env, GITHUB_REPOSITORY: "aloeducation-org-crm/definitely-not-a-real-repo-9x7" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      });
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      status = e.status ?? 1;
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? "";
    }
    if (status === 0) {
      // Resolved a real SHA (for example from a cached network): still valid, as
      // long as it is a SHA and not a fabricated placeholder.
      expect(stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
    } else {
      expect(status).toBe(1);
      expect(stdout.trim()).toBe("");
      expect(stderr).toContain("Refusing to guess");
    }
  });

  it("is what the deploy scripts consult instead of a shallow origin/main", () => {
    const releaseScript = read("scripts/deploy-release.sh");
    expect(releaseScript).toContain('latest-main-sha.mjs');
    expect(releaseScript).toContain("LATEST_MAIN_SHA=");
    // The vacuous form must not come back. In a shallow clone this is true for
    // the stale run it is meant to reject.
    expect(releaseScript).not.toContain('LATEST_MAIN_SHA="$(git rev-parse origin/main)"');
    expect(read(".github/workflows/ci-cd.yml")).toContain("latest-main-sha.mjs");
  });
});

// ─── 4. Where the guard sits, and what the workflow promises ─────────────────

describe("guard placement and workflow wiring", () => {
  const releaseScript = read("scripts/deploy-release.sh");
  const workflow = loadYaml(read(".github/workflows/ci-cd.yml")) as {
    jobs: Record<string, { if?: string; steps?: Array<Record<string, unknown>>; concurrency?: unknown }>;
    on?: unknown;
  };

  it("decides authorization before choosing a deployment shape, so canonical is covered too", () => {
    const guardAt = releaseScript.indexOf("0. Is this release allowed to activate at all?");
    const shapeAt = releaseScript.indexOf("1. Read-only preflight decides the shape");
    const canonicalAt = releaseScript.indexOf('if [[ "$MODE" == "canonical" ]]');
    const mutateAt = releaseScript.indexOf("3c. Move to the target commit");

    expect(guardAt).toBeGreaterThan(0);
    expect(shapeAt).toBeGreaterThan(guardAt);
    expect(canonicalAt).toBeGreaterThan(shapeAt);
    expect(mutateAt).toBeGreaterThan(canonicalAt);
  });

  it("records the rollback audit trail outside the Git checkout", () => {
    // Writing it into the tree would recreate the deadlock these tests exist to
    // prevent: the record would make the next deployment's dirty check fail.
    expect(releaseScript).toContain("rollback-audit.jsonl");
    expect(releaseScript).toContain("ALO_ROLLBACK_AUDIT_FILE");
    expect(releaseScript).toMatch(/ROLLBACK_AUDIT_FILE="\$\{ALO_ROLLBACK_AUDIT_FILE:-\$\{LOG_DIR\}\/rollback-audit\.jsonl\}"/);
    expect(releaseScript).not.toMatch(/appendFileSync\([^)]*APP_DIR/);
  });

  it("re-validates the target immediately before the irreversible step", () => {
    const revalidateAt = releaseScript.indexOf("REVALIDATED_MAIN_SHA=");
    const resetAt = releaseScript.indexOf('git reset --hard "$SHA"');
    expect(revalidateAt).toBeGreaterThan(0);
    expect(resetAt).toBeGreaterThan(revalidateAt);
  });

  it("keeps deployment serialization single-flight and never cancels a deploy in flight", () => {
    const deploy = workflow.jobs.deploy;
    expect(deploy.concurrency).toMatchObject({ group: "hosting-production-deploy", "cancel-in-progress": false });
    expect(deploy.environment).toBe("production");
  });

  it("gives the deploy job full history, because ancestry cannot be answered from a shallow clone", () => {
    const checkout = workflow.jobs.deploy.steps?.find(
      (step) => String(step.uses ?? "").startsWith("actions/checkout"),
    ) as { with?: Record<string, unknown> } | undefined;
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });

  it("re-checks main's head after the run has waited for the deploy slot", () => {
    const names = (workflow.jobs.deploy.steps ?? []).map((step) => String(step.name ?? ""));
    expect(names.some((n) => n.includes("after acquiring the deploy slot"))).toBe(true);
  });

  it("rejects an obsolete run before downloading the release payload", () => {
    const steps = workflow.jobs["deploy-preflight"].steps ?? [];
    const gate = steps.findIndex((step) =>
      String(step.name ?? "").includes("main has already moved past"),
    );
    const download = steps.findIndex((step) =>
      String(step.uses ?? "").startsWith("actions/download-artifact"),
    );
    expect(gate).toBeGreaterThan(-1);
    expect(download).toBeGreaterThan(gate);
  });

  it("can never deploy from pull request code", () => {
    for (const job of ["deploy-preflight", "deploy"]) {
      const condition = String(workflow.jobs[job].if ?? "");
      expect(condition).toContain("refs/heads/main");
      expect(condition).not.toContain("pull_request");
    }
    // And the artifact itself is only ever produced on main.
    const upload = (workflow.jobs.build.steps ?? []).find((step) =>
      String(step.name ?? "").includes("Upload verified release payload"),
    ) as { if?: string } | undefined;
    expect(String(upload?.if)).toContain("refs/heads/main");
    expect(String(upload?.if)).not.toContain("pull_request");
  });

  it("exposes rollback only as an attributed, dispatch-time decision", () => {
    const triggers = workflow.on as Record<string, { inputs?: Record<string, unknown> }>;
    expect(triggers.workflow_dispatch?.inputs).toMatchObject({
      allow_rollback: expect.any(Object),
      rollback_operator: expect.any(Object),
      rollback_reason: expect.any(Object),
    });
    // Stored configuration must not be able to arm a rollback permanently.
    const yaml = read(".github/workflows/ci-cd.yml");
    expect(yaml).not.toMatch(/ALLOW_RELEASE_ROLLBACK:\s*\$\{\{\s*vars\./);
    expect(yaml).not.toMatch(/ALLOW_RELEASE_ROLLBACK:\s*['"]?1['"]?\s*$/m);
  });

  it("every shell script still parses", () => {
    for (const script of [
      "scripts/deploy-release.sh",
      "scripts/deploy-production.sh",
      "scripts/deploy-preflight.sh",
      "scripts/host-checkout-status.sh",
    ]) {
      expect(() => execFileSync("bash", ["-n", path.join(REPO, script)], { encoding: "utf8" }), script).not.toThrow();
    }
  });
});
