/**
 * SEC-01 regression tests — customer build isolation.
 *
 * The defect these tests exist to prevent: customer repository code used to be
 * spawned directly from the control-plane process with that process's identity
 * and mount namespace. On the documented production host that identity is
 * root-equivalent, so a `postinstall` script in any customer repository could
 * read `.env`, the fixture database and the release tree.
 *
 * What is proven here:
 *   1. the isolation plan wraps customer commands rather than running them bare;
 *   2. the wrapper's argv is an allowlisted shape (no shell string
 *      interpolation of the customer command, no network by default);
 *   3. the policy is fail-closed — `required` refuses to build when no boundary
 *      exists, and `none` is refused outright in production;
 *   4. a build environment carrying a platform secret is refused before spawn;
 *   5. the deployment engine routes every customer build stage through
 *      `runIsolatedCommand`, which a source scan enforces so a future edit
 *      cannot quietly reintroduce the direct `runCommand` call.
 *
 * What is NOT proven here, and must not be claimed: that `unshare` succeeds on
 * the production host. This sandbox denies user namespaces, so the namespace
 * path is exercised only through argv construction and the fail-closed branch.
 * The host-level check is `node scripts/probe-build-isolation.mjs`, recorded in
 * docs/audit/BUILD-ISOLATION.md.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  isolationPolicy,
  planBuildIsolation,
  unshareArgv,
  bwrapArgv,
  sandboxExecArgv,
  describeIsolation,
  resetIsolationProbeCache,
  type IsolationMode,
} from "../src/lib/deploy/sandbox";
import { matchesPlatformSecretName } from "../src/lib/deploy/redact";
import { runIsolatedCommand } from "../src/lib/deploy/engine";

const ROOT = path.resolve(__dirname, "..");
const ENV_KEYS = ["DEPLOY_BUILD_ISOLATION", "DEPLOY_ALLOW_UNISOLATED_BUILDS", "DEPLOY_BUILD_NETWORK", "DEPLOY_BUILD_RLIMITS"];

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  resetIsolationProbeCache();
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const available = (mode: IsolationMode) => async () => ({ mode, available: true as const });
const unavailable = (mode: IsolationMode, reason: string) => async () => ({ mode, available: false as const, reason });

describe("SEC-01 isolation policy", () => {
  it("defaults to required in production, so a host without namespaces cannot build", () => {
    expect(isolationPolicy(undefined, "production")).toBe("required");
    expect(isolationPolicy("", "production")).toBe("required");
  });

  it("defaults to auto outside production", () => {
    expect(isolationPolicy(undefined, "development")).toBe("auto");
  });

  it("refuses an explicit 'none' in production without the documented exception", () => {
    delete process.env.DEPLOY_ALLOW_UNISOLATED_BUILDS;
    expect(() => isolationPolicy("none", "production")).toThrow(/refused in production/);
  });

  it("honours an explicit 'none' in production only with DEPLOY_ALLOW_UNISOLATED_BUILDS=1", () => {
    process.env.DEPLOY_ALLOW_UNISOLATED_BUILDS = "1";
    expect(isolationPolicy("none", "production")).toBe("none");
  });

  it("throws on an unknown value instead of silently defaulting", () => {
    expect(() => isolationPolicy("namespaces-please", "development")).toThrow(/must be one of/);
  });
});

describe("SEC-01 isolation plan", () => {
  const options = { workDir: "/tmp/alo-build-x", chdir: "/tmp/alo-build-x/src", env: {} };

  it("wraps a customer command in unshare when it is available", async () => {
    const plan = await planBuildIsolation(["npm", "ci", "--ignore-scripts=false"], options, {
      policy: "auto",
      platform: "linux",
      probe: async (mode) => (mode === "unshare" ? { mode, available: true } : { mode, available: false, reason: "not installed" }),
    });
    expect(plan.unisolated).toBe(false);
    expect(plan.mode).toBe("unshare");
    expect(plan.argv[0]).toBe("unshare");
    // The customer command is passed as argv, never embedded in a shell string.
    // The only `-c` script in the wrapper is the fixed `cd`/`exec` trampoline,
    // and it contains no part of the customer command.
    expect(plan.argv.slice(-3)).toEqual(["npm", "ci", "--ignore-scripts=false"]);
    const dashC = plan.argv.indexOf("-c");
    expect(dashC).toBeGreaterThan(-1);
    const script = plan.argv[dashC + 1]!;
    expect(script).toBe('cd "$1" || exit 1\nshift\nexec "$@"');
    for (const arg of ["npm", "ci", "--ignore-scripts=false"]) expect(script).not.toContain(arg);
  });

  it("prefers bwrap over unshare on Linux because it has a stricter bind list", async () => {
    const plan = await planBuildIsolation(["npm", "ci"], options, {
      policy: "auto",
      platform: "linux",
      probe: async (mode) => ({ mode, available: mode === "bwrap" || mode === "unshare" }),
    });
    expect(plan.mode).toBe("bwrap");
    expect(plan.argv[0]).toBe("bwrap");
  });

  it("isolates the network by default and only shares it when explicitly enabled", async () => {
    delete process.env.DEPLOY_BUILD_NETWORK;
    const isolated = await planBuildIsolation(["npm", "ci"], options, {
      policy: "unshare",
      platform: "linux",
      probe: available("unshare"),
    });
    expect(isolated.argv).toContain("--net");

    process.env.DEPLOY_BUILD_NETWORK = "1";
    const networked = await planBuildIsolation(["npm", "ci"], options, {
      policy: "unshare",
      platform: "linux",
      probe: available("unshare"),
    });
    expect(networked.argv).not.toContain("--net");
  });

  it("fails closed under 'required' when no boundary exists", async () => {
    await expect(
      planBuildIsolation(["npm", "ci"], options, {
        policy: "required",
        platform: "linux",
        probe: async (mode) => ({ mode, available: mode === "none", reason: "everything unavailable" }),
      }),
    ).rejects.toThrow(/Refusing to run an untrusted customer build/);
  });

  it("fails closed when a pinned mode is unavailable instead of downgrading", async () => {
    await expect(
      planBuildIsolation(["npm", "ci"], options, {
        policy: "bwrap",
        platform: "linux",
        probe: unavailable("bwrap", "bwrap binary not found"),
      }),
    ).rejects.toThrow(/requested but is not available/);
  });

  it("returns an auditable unisolated plan under 'auto' and says so out loud", async () => {
    const plan = await planBuildIsolation(["npm", "ci"], options, {
      policy: "auto",
      platform: "linux",
      probe: async (mode) => ({ mode, available: mode === "none", reason: "no namespaces" }),
    });
    expect(plan.unisolated).toBe(true);
    expect(plan.argv).toEqual(["npm", "ci"]);
    expect(describeIsolation(plan)).toMatch(/^build isolation: NONE/);
  });
});

describe("SEC-01 wrapper argv shape", () => {
  const options = { workDir: "/tmp/build", chdir: "/tmp/build/src", env: {} };

  it("unshare keeps the current uid and does not pretend to be root", () => {
    const argv = unshareArgv(["npm", "ci"], options, { allowNetwork: false });
    expect(argv).toContain("--map-current-user");
    expect(argv).not.toContain("--map-root-user");
  });

  it("unshare gives the build a private /proc so it cannot read control-plane command lines", () => {
    const argv = unshareArgv(["npm", "ci"], options, { allowNetwork: false });
    expect(argv).toContain("--mount-proc");
    expect(argv).toContain("--pid");
    expect(argv).toContain("--kill-child");
  });

  it("bwrap exposes only system read-only paths plus the work directory", () => {
    const argv = bwrapArgv(["npm", "ci"], options, { allowNetwork: false });
    expect(argv).toContain("--unshare-all");
    expect(argv.join(" ")).toContain("--bind /tmp/build /tmp/build");
    const writable = argv.filter((a) => a === "--bind");
    expect(writable).toHaveLength(1);
  });

  it("sandbox-exec denies network access", () => {
    const argv = sandboxExecArgv(["npm", "ci"], options);
    expect(argv[0]).toBe("sandbox-exec");
    expect(argv[2]).toContain("(deny network*)");
  });
});

describe("SEC-01 build environment", () => {
  it("recognises platform secret variable names", () => {
    for (const name of ["NEXTAUTH_SECRET", "DATABASE_URL", "STRIPE_SECRET_KEY", "GITHUB_APP_PRIVATE_KEY", "MY_API_KEY", "APP_ENCRYPTION_KEY"]) {
      expect(matchesPlatformSecretName(name), name).toBe(true);
    }
    for (const name of ["PATH", "HOME", "CI", "API_URL", "MY_SERVICE_HOST", "NODE_ENV"]) {
      expect(matchesPlatformSecretName(name), name).toBe(false);
    }
  });

  it("refuses to run a build whose environment contains a platform secret", async () => {
    const run = await runIsolatedCommand(["true"], {
      workDir: os.tmpdir(),
      chdir: os.tmpdir(),
      cwd: os.tmpdir(),
      env: { PATH: "/usr/bin:/bin", DATABASE_URL: "file:/var/lib/alo-hosting/alo.db" },
      isolation: { mode: "none", argv: ["true"], unisolated: true, description: "" },
    }).catch((error: Error) => error);
    expect(run).toBeInstanceOf(Error);
    expect((run as Error).message).toMatch(/refusing to run a build with platform secret variables/);
  });

  it("executes a clean command and reports the boundary it used", async () => {
    const result = await runIsolatedCommand(["/bin/sh", "-c", "printf isolated-ok"], {
      workDir: os.tmpdir(),
      chdir: os.tmpdir(),
      cwd: os.tmpdir(),
      env: { PATH: "/usr/bin:/bin" },
      isolation: { mode: "none", argv: ["/bin/sh", "-c", "printf isolated-ok"], unisolated: true, description: "" },
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("isolated-ok");
    expect(result.isolation.mode).toBe("none");
  });

  /**
   * The adversarial case the defect described: a repository whose `postinstall`
   * tries to read the control plane's environment. The build environment is
   * constructed by `buildEnvironment`, which starts from an empty base, so the
   * canary is not present even before the namespace reaches it.
   */
  it("does not leak the control-plane environment into a build", async () => {
    process.env.ALO_TEST_CANARY_SECRET = "canary-value-must-not-appear";
    try {
      const result = await runIsolatedCommand(["/bin/sh", "-c", "printf %s \"${ALO_TEST_CANARY_SECRET:-absent}\""], {
        workDir: os.tmpdir(),
        chdir: os.tmpdir(),
        cwd: os.tmpdir(),
        env: { PATH: "/usr/bin:/bin" },
        isolation: { mode: "none", argv: ["/bin/sh", "-c", 'printf %s "${ALO_TEST_CANARY_SECRET:-absent}"'], unisolated: true, description: "" },
      });
      expect(result.output).toContain("absent");
      expect(result.output).not.toContain("canary-value");
    } finally {
      delete process.env.ALO_TEST_CANARY_SECRET;
    }
  });
});

describe("SEC-01 engine wiring", () => {
  /**
   * A source scan is the regression test that survives refactoring: it fails if
   * any customer build stage is ever spawned with a bare `runCommand` again.
   */
  it("routes every customer build stage through runIsolatedCommand", () => {
    const engine = fs.readFileSync(path.join(ROOT, "src/lib/deploy/engine.ts"), "utf8");
    const runBlock = engine.slice(engine.indexOf("const run = async (label: DeployStage"));
    const stageCall = runBlock.slice(0, runBlock.indexOf("await run(\"install\""));
    expect(stageCall).toContain("runIsolatedCommand(");
    expect(stageCall).not.toMatch(/\brunCommand\(/);
  });

  it("keeps trusted host-side git operations on the unwrapped runner", () => {
    const engine = fs.readFileSync(path.join(ROOT, "src/lib/deploy/engine.ts"), "utf8");
    const gitBlock = engine.slice(engine.indexOf("async function gitCheckout"), engine.indexOf("async function packageRelease"));
    expect(gitBlock).toContain("execFileAsync(\"git\"");
    expect(gitBlock).not.toContain("runIsolatedCommand");
  });

  it("plans the boundary before the first customer command runs", () => {
    const engine = fs.readFileSync(path.join(ROOT, "src/lib/deploy/engine.ts"), "utf8");
    const planAt = engine.indexOf("const plannedIsolation");
    const firstStage = engine.indexOf('await run("install"');
    expect(planAt).toBeGreaterThan(-1);
    expect(planAt).toBeLessThan(firstStage);
  });
});

/**
 * Host-level probe, skipped when namespaces are unavailable.
 *
 * It runs only when `ALO_ISOLATION_PROBE=1` so a developer machine without
 * unprivileged user namespaces does not report a spurious failure. The value of
 * the test is that on a host where the boundary *does* work, the containment is
 * asserted with a real canary file rather than by inspecting argv.
 */
describe("SEC-01 real containment (host probe)", () => {
  const enabled = process.env.ALO_ISOLATION_PROBE === "1";
  let tmp = "";
  it.skipIf(!enabled)("hides a host file from a build running in a namespace", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "alo-iso-probe-"));
    const canary = path.join(tmp, "canary.txt");
    fs.writeFileSync(canary, "SECRET_CANARY");
    const work = path.join(tmp, "work");
    fs.mkdirSync(work);

    // The canary sits outside the work dir, so a correct boundary hides it.
    const outside = path.join(tmp, "outside.txt");
    fs.writeFileSync(outside, "OUTSIDE");
    const result = await runIsolatedCommand(["/bin/cat", outside], {
      workDir: work,
      chdir: work,
      cwd: work,
      env: { PATH: "/usr/bin:/bin" },
    });
    expect(result.isolation.unisolated).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.output).not.toContain("OUTSIDE");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
