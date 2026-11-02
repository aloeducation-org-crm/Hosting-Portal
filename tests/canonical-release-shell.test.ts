import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, unlinkSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = process.cwd(); const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "canonical-release-")); dirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@test.invalid");
  const commits: string[] = [];
  for (const value of ["old", "new"]) { writeFileSync(path.join(dir, "app.txt"), value); git("add", "app.txt"); git("commit", "-m", value); commits.push(git("rev-parse", "HEAD")); }
  git("remote", "add", "origin", dir);
  const [old, latest] = commits; const app = path.join(dir, "app"); const current = path.join(app, "current");
  mkdirSync(path.join(dir, "scripts")); mkdirSync(path.join(app, "logs"), { recursive: true });
  for (const sha of commits) { mkdirSync(path.join(app, "releases", sha), { recursive: true }); writeFileSync(path.join(app, "releases", sha, "release-identity.json"), JSON.stringify({ commitSha: sha })); }
  symlinkSync(path.join(app, "releases", old), current);
  writeFileSync(path.join(dir, "scripts/latest-main-sha.mjs"), 'process.stdout.write(process.env.TEST_HEAD || "");process.exitCode=Number(process.env.TEST_LOOKUP_EXIT || 0);');
  for (const file of ["canonical-release-check.mjs", "release-audit.mjs"]) symlinkSync(path.join(root, "scripts", file), path.join(dir, "scripts", file));
  const env = { ...process.env, TEST_HEAD: latest };
  const check = (options: Record<string, string> = {}, target = latest) => spawnSync(process.execPath, [path.join(root, "scripts/canonical-release-check.mjs"), dir, current, target], { encoding: "utf8", env: { ...env, ...options }, timeout: 15000 });
  const activate = (options: Record<string, string> = {}, target = latest) => {
    const script = readFileSync(path.join(root, "scripts/deploy-production.sh"), "utf8");
    const section = script.slice(script.indexOf("# Final canonical activation boundary"), script.indexOf("activated=1\nlog"));
    return spawnSync("bash", ["-c", `set -Eeuo pipefail\nfail() { echo "$*" >&2; exit 1; }\n${section}`], { encoding: "utf8", timeout: 15000, env: { ...env, ROOT: dir, CURRENT: current, SHA: target, RELEASE: path.join(app, "releases", target), APP_ROOT: app, previous: path.join(app, "releases", old), ...options } });
  };
  return { dir, app, old, latest, current, check, activate, git };
}
describe("canonical fresh activation boundary (real shell/git/filesystem)", () => {
  it("activates latest main only after a durable authorization record", () => {
    const f = fixture(); const result = f.activate(); expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(f.current, "release-identity.json"), "utf8")).toContain(f.latest);
    const audit = JSON.parse(readFileSync(path.join(f.app, "logs/activation-audit.jsonl"), "utf8"));
    expect(audit.decision.authorized).toBe(true); expect(audit.facts.runningSha).toBe(f.old);
  });
  it.each([{ TEST_HEAD: "bad" }, { TEST_LOOKUP_EXIT: "1" }])("leaves current unchanged on unavailable head %j", (env) => {
    const f = fixture(); expect(f.activate(env).status).not.toBe(0); expect(readFileSync(path.join(f.current, "release-identity.json"), "utf8")).toContain(f.old);
  });
  it("refuses stale queued targets", () => { const f = fixture(); unlinkSync(f.current); expect(f.check({}, f.old).status).not.toBe(0); });
  it("fails closed when history refresh fails", () => { const f = fixture(); f.git("remote", "set-url", "origin", path.join(f.dir, "missing")); expect(f.check().status).not.toBe(0); });
  it("requires attributable rollback", () => {
    const f = fixture(); unlinkSync(f.current); symlinkSync(path.join(f.app, "releases", f.latest), f.current);
    expect(f.check({}, f.old).status).not.toBe(0);
    expect(f.check({ ALLOW_RELEASE_ROLLBACK: "1" }, f.old).status).not.toBe(0);
    const allowed = f.check({ ALLOW_RELEASE_ROLLBACK: "1", RELEASE_ROLLBACK_OPERATOR: "admin", RELEASE_ROLLBACK_REASON: "verified recovery" }, f.old);
    expect(allowed.status, allowed.stderr).toBe(0); expect(JSON.parse(allowed.stdout).decision.rollback).toBe(true);
  });
  it("refuses a dangling current symlink", () => { const f = fixture(); unlinkSync(f.current); symlinkSync(path.join(f.app, "missing"), f.current); expect(f.check().status).not.toBe(0); });
  it("refuses missing or inconsistent current identity", () => {
    const f = fixture(); const file = path.join(f.current, "release-identity.json");
    writeFileSync(file, JSON.stringify({ commitSha: f.latest })); expect(f.check().status).not.toBe(0);
    unlinkSync(file); expect(f.check().status).not.toBe(0);
  });
  it("activates a first deployment with no previous symlink", () => { const f = fixture(); unlinkSync(f.current); const result = f.activate({ previous: "" }); expect(result.status, result.stderr).toBe(0); });
  it("permits a genuinely first deployment", () => { const f = fixture(); unlinkSync(f.current); const result = f.check(); expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout).facts.runningSha).toBe(null); });
  it("refuses a current release changed since deployment began", () => {
    const f = fixture(); const result = f.activate({ previous: path.join(f.app, "releases", f.latest) });
    expect(result.status).not.toBe(0); expect(readFileSync(path.join(f.current, "release-identity.json"), "utf8")).toContain(f.old);
  });
  it("refuses activation when the audit cannot be appended", () => {
    const f = fixture(); mkdirSync(path.join(f.app, "logs/activation-audit.jsonl"));
    expect(f.activate().status).not.toBe(0); expect(readFileSync(path.join(f.current, "release-identity.json"), "utf8")).toContain(f.old);
  });
  it("refuses a symlink audit destination without touching its target", () => {
    const f = fixture(); const target = path.join(f.dir, "untouched"); writeFileSync(target, "preserve"); symlinkSync(target, path.join(f.app, "logs/activation-audit.jsonl"));
    expect(f.activate().status).not.toBe(0); expect(readFileSync(target, "utf8")).toBe("preserve");
  });
  it("the actual canonical lock rejects a second holder", () => {
    const f = fixture(); const script = readFileSync(path.join(root, "scripts/deploy-production.sh"), "utf8");
    const section = script.slice(script.indexOf('command -v flock'), script.indexOf('[[ -w "$RELEASES" ]]'));
    const result = spawnSync("bash", ["-c", `set -Eeuo pipefail\nfail() { exit 1; }\nexec 8>"$APP_ROOT/.canonical-deploy.lock"\nflock -n 8\n${section}`], { env: { ...process.env, APP_ROOT: f.app }, encoding: "utf8", timeout: 10000 });
    expect(result.status).not.toBe(0); expect(existsSync(f.current)).toBe(true);
  });
});
