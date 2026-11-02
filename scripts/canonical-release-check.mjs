#!/usr/bin/env node
/** Fresh fail-closed policy immediately before canonical activation. No writes. */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readlinkSync, realpathSync, lstatSync } from "node:fs";
import path from "node:path";
import { register } from "tsx/esm/api";

async function main() {
  const [repo, current, targetSha] = process.argv.slice(2);
  if (!repo || !current || !/^[a-f0-9]{40}$/.test(targetSha || "")) throw new Error("Invalid canonical guard arguments");
  let runningSha = null; let sourceRelease = null;
  try {
    const stat = lstatSync(current);
    if (!stat.isSymbolicLink()) throw new Error("Current release is not a symlink");
    // Preserve the literal link for the final compare, including relative links.
    sourceRelease = readlinkSync(current);
    const resolved = realpathSync(current);
    const releases = realpathSync(path.join(path.dirname(current), "releases"));
    if (path.dirname(resolved) !== releases) throw new Error("Current release is outside the immutable release directory");
    const identity = JSON.parse(readFileSync(path.join(resolved, "release-identity.json"), "utf8"));
    runningSha = identity.commitSha;
    if (!/^[a-f0-9]{40}$/.test(runningSha || "") || path.basename(resolved) !== runningSha) throw new Error("Current release identity is invalid");
  } catch (error) {
    // Only a genuinely absent current path is a first deployment. A dangling
    // symlink or missing identity must not be downgraded to first deployment.
    let absent = false;
    try { lstatSync(current); } catch (probe) { absent = probe.code === "ENOENT"; }
    if (!absent) throw error;
  }
  const latestMainSha = execFileSync(process.execPath, [path.join(repo, "scripts/latest-main-sha.mjs"), "--ref", "main"], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (!/^[a-f0-9]{40}$/.test(latestMainSha)) throw new Error("Main head unavailable");
  execFileSync("git", ["-C", repo, "fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"], { timeout: 30000, stdio: "pipe" });
  const ancestor = (from, to) => {
    if (!from || !to) return undefined;
    for (const sha of [from, to]) execFileSync("git", ["-C", repo, "cat-file", "-e", `${sha}^{commit}`], { timeout: 10000, stdio: "pipe" });
    const result = spawnSync("git", ["-C", repo, "merge-base", "--is-ancestor", from, to], { timeout: 10000, stdio: "pipe" });
    if (result.status !== 0 && result.status !== 1) throw new Error("Ancestry unavailable");
    return result.status === 0;
  };
  const facts = { targetSha, latestMainSha, runningSha, targetOnMain: ancestor(targetSha, latestMainSha), runningIsAncestorOfTarget: ancestor(runningSha, targetSha), targetIsAncestorOfRunning: ancestor(targetSha, runningSha) };
  const authorization = { allowRollback: process.env.ALLOW_RELEASE_ROLLBACK === "1", operator: process.env.RELEASE_ROLLBACK_OPERATOR, reason: process.env.RELEASE_ROLLBACK_REASON };
  const unregister = register();
  try {
    const { decideReleaseActivation } = await import("../src/lib/deploy/release-guard.ts");
    const decision = decideReleaseActivation(facts, authorization);
    if (!decision.authorized) throw new Error(`Activation refused: ${decision.code}`);
    process.stdout.write(JSON.stringify({ event: "canonical-activation-authorized", recordedAt: new Date().toISOString(), facts, authorization, decision, sourceRelease }));
  } finally { unregister(); }
}
main().catch(() => { process.stderr.write("Canonical release revalidation failed; activation refused.\n"); process.exitCode = 1; });
