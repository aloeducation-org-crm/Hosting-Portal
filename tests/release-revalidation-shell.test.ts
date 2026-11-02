import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const script = readFileSync(path.join(root, "scripts/deploy-release.sh"), "utf8");
// Execute the actual production section, including checkout/reset, but only in
// throwaway repositories. No copied policy and no production command execution.
const section = script.slice(script.indexOf("# ── 3c."), script.indexOf("\nnpm ci --include=dev", script.indexOf("# ── 3c.")));
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "release-revalidation-"));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "fixture@example.test");
  git("config", "user.name", "Release fixture");
  const commits: string[] = [];
  for (const content of ["old", "target", "latest"]) {
    writeFileSync(path.join(dir, "app.txt"), content);
    git("add", "app.txt"); git("commit", "-m", content);
    commits.push(git("rev-parse", "HEAD"));
  }
  git("remote", "add", "origin", dir);
  const bin = path.join(dir, "bin"); mkdirSync(bin);
  writeFileSync(path.join(bin, "node"), `#!/usr/bin/env bash
if [[ "$1" == */latest-main-sha.mjs ]]; then
  printf '%s' "$TEST_MAIN_SHA"
  exit "\${TEST_LOOKUP_EXIT:-0}"
fi
exec ${JSON.stringify(process.execPath)} "$@"
`, { mode: 0o755 });
  const actualGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  writeFileSync(path.join(bin, "git"), `#!/usr/bin/env bash
if [[ "$1" == fetch && "\${TEST_FETCH_FAIL:-0}" == 1 ]]; then exit 128; fi
exec ${JSON.stringify(actualGit)} "$@"
`, { mode: 0o755 });
  const [old, target, latest] = commits;
  function run(options: { target?: string; running?: string; head?: string; rollback?: boolean; operator?: string; reason?: string; lookupExit?: string; fetchFail?: boolean; originalRollback?: boolean; auditFail?: boolean } = {}) {
    const sha = options.target ?? latest;
    const running = options.running ?? target;
    const result = spawnSync("bash", ["-c", `set -Eeuo pipefail
fail() { echo "$*" >&2; exit 1; }
log() { echo "$*"; }
${section}
`], {
      cwd: dir, encoding: "utf8", timeout: 15000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ROOT: root, SHA: sha,
        PREV_SHA: latest, RUNNING_SHA: running, LOG_DIR: dir, ALO_ROLLBACK_AUDIT_FILE: options.auditFail ? path.join(dir, "missing", "audit.jsonl") : path.join(dir, "rollback-audit.jsonl"),
        GUARD_ROLLBACK: String(options.originalRollback ?? options.rollback ?? false),
        GUARD_FACTS: JSON.stringify({ targetSha: sha, runningSha: running, latestMainSha: latest, targetOnMain: true }),
        GUARD_AUTH: JSON.stringify({ allowRollback: options.rollback ?? false, operator: options.operator, reason: options.reason }),
        TEST_MAIN_SHA: options.head ?? latest, TEST_LOOKUP_EXIT: options.lookupExit ?? "0", TEST_FETCH_FAIL: options.fetchFail ? "1" : "0",
      },
    });
    return { ...result, head: git("rev-parse", "HEAD"), content: readFileSync(path.join(dir, "app.txt"), "utf8") };
  }
  return { dir, git, old, target, latest, run };
}

describe("inline release final revalidation (real shell + git + policy bridge)", () => {
  it("activates the current main head", () => {
    const f = fixture(); const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.head).toBe(f.latest);
    expect(result.stdout).toContain(`checked out ${f.latest}`);
  });
  it("refuses rollback before checkout when durable audit fails", () => {
    const f = fixture(); const result = f.run({ target: f.target, running: f.latest, rollback: true, operator: "operator", reason: "verified recovery", auditFail: true });
    expect(result.status).not.toBe(0); expect(result.head).toBe(f.latest); expect(result.stderr).toContain("rollback audit unavailable");
  });
  it("persists attributable rollback authorization before checkout", () => {
    const f = fixture(); const result = f.run({ target: f.target, running: f.latest, rollback: true, operator: "operator", reason: "verified recovery" });
    expect(result.status, result.stderr).toBe(0);
    const record = JSON.parse(readFileSync(path.join(f.dir, "rollback-audit.jsonl"), "utf8"));
    expect(record).toMatchObject({ operator: "operator", sourceRelease: f.latest, targetRelease: f.target, reason: "verified recovery" });
    expect(record.deploymentId).toBeTruthy();
  });
  it("permits an attributed rollback to an older merged release", () => {
    const f = fixture(); const result = f.run({ target: f.target, running: f.latest, rollback: true, operator: "operator", reason: "verified recovery" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.head).toBe(f.target);
    expect(result.content).toBe("target");
  });
  it.each([
    { head: "", label: "empty head" },
    { head: "invalid", label: "malformed head" },
    { lookupExit: "1", label: "failed lookup even with valid output" },
    { fetchFail: true, label: "failed history refresh" },
  ])("refuses $label without moving the checkout", (options) => {
    const f = fixture(); const result = f.run(options);
    expect(result.status).not.toBe(0);
    expect(result.head).toBe(f.latest);
    expect(result.content).toBe("latest");
    expect(result.stdout).not.toContain("checked out");
  });
  it("refuses a superseded forward release", () => {
    const f = fixture(); const result = f.run({ target: f.target, running: f.old });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stale-target");
    expect(result.head).toBe(f.latest);
  });
  it("refuses a backwards release without explicit approval", () => {
    const f = fixture(); const result = f.run({ target: f.target, running: f.latest });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("backward-release");
    expect(result.head).toBe(f.latest);
  });
  it.each([{ operator: "operator" }, { reason: "recovery" }])("refuses incomplete rollback attribution %j", (attribution) => {
    const f = fixture(); const result = f.run({ target: f.target, running: f.latest, rollback: true, ...attribution });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unattributed-rollback");
    expect(result.head).toBe(f.latest);
  });
  it("does not treat a raw rollback flag as the original guard decision", () => {
    const f = fixture(); const result = f.run({ target: f.target, running: f.latest, rollback: true, originalRollback: false, operator: "operator", reason: "recovery" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("without an attributed rollback decision");
    expect(result.head).toBe(f.latest);
  });
  it("refuses unavailable running ancestry instead of guessing", () => {
    const f = fixture(); const result = f.run({ running: "a".repeat(40) });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("could not verify running release ancestry");
    expect(result.head).toBe(f.latest);
  });
  it("refuses an unmerged target even with attributed rollback authorization", () => {
    const f = fixture();
    const tree = f.git("rev-parse", "HEAD^{tree}");
    const unmerged = f.git("commit-tree", tree, "-m", "unmerged");
    const result = f.run({ target: unmerged, running: f.latest, rollback: true, operator: "operator", reason: "recovery" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unmerged-target");
    expect(result.head).toBe(f.latest);
  });
});
