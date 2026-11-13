/**
 * REL-03 — the deployment worker must be supervised.
 *
 * The orchestrator has shipped with a systemd unit, a Compose service and a CI
 * entrypoint check for a while. `scripts/deploy-worker.ts` did not: an install
 * that sets DEPLOY_INLINE_WORKER=false (the recommended production setting) had
 * nothing draining PENDING deployments, and the script itself had no SIGTERM
 * handling and no liveness signal, so a supervisor could not have told a healthy
 * worker from a wedged one.
 *
 * A unit file is not "verified running" by a test -- that needs a host. What a
 * test can do, and does here, is refuse the failure modes that make a unit
 * useless: pointing at a bundle the build does not produce, missing a start
 * ordering constraint, missing a drain window, or a heartbeat nothing refreshes.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function hasSystemdAnalyze(): boolean {
  try {
    execFileSync("which", ["systemd-analyze"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const REPO = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(REPO, p), "utf8");

const UNIT = "deploy/systemd/alo-deploy-worker.service";
const SCRIPT = "scripts/deploy-worker.ts";

describe("REL-03: the deploy worker unit exists and is installable", () => {
  it("ships a unit file", () => {
    expect(fs.existsSync(path.join(REPO, UNIT))).toBe(true);
  });

  it("declares a restart policy and a bounded restart delay", () => {
    const unit = read(UNIT);
    expect(unit).toMatch(/^Restart=always$/m);
    expect(unit).toMatch(/^RestartSec=\d+s$/m);
  });

  it("runs as the unprivileged panel user", () => {
    const unit = read(UNIT);
    expect(unit).toMatch(/^User=alo-panel$/m);
    expect(unit).toMatch(/^Group=alo-panel$/m);
  });

  it("starts after the panel so the database is initialised", () => {
    const unit = read(UNIT);
    expect(unit).toMatch(/^After=.*alo-hosting-panel\.service/m);
  });

  it("stops with the panel rather than outliving it", () => {
    const unit = read(UNIT);
    expect(unit).toMatch(/^PartOf=alo-hosting-panel\.service$/m);
  });

  it("allows a long enough drain window for a build to finish on SIGTERM", () => {
    const unit = read(UNIT);
    const stop = unit.match(/^TimeoutStopSec=(\d+)$/m);
    expect(stop).not.toBeNull();
    // DEPLOY_COMMAND_TIMEOUT_MS defaults to 10 minutes per command and a build
    // runs several; anything under that window kills healthy work.
    expect(Number(stop![1])).toBeGreaterThanOrEqual(900);
  });

  it("caps memory and kills the cgroup on OOM rather than swapping", () => {
    const unit = read(UNIT);
    expect(unit).toMatch(/^MemoryMax=\d+[MG]$/m);
    expect(unit).toMatch(/^MemorySwapMax=0$/m);
    expect(unit).toMatch(/^OOMPolicy=kill$/m);
  });

  it("creates the runtime directory the heartbeat file lives in", () => {
    const unit = read(UNIT);
    expect(unit).toMatch(/^RuntimeDirectory=alo-hosting$/m);
    // The heartbeat path must be inside that directory, or systemd's sandbox
    // gives the process nowhere to write it and the healthcheck never passes.
    const heartbeat = unit.match(/^Environment=DEPLOY_WORKER_HEARTBEAT_FILE=(.+)$/m);
    expect(heartbeat).not.toBeNull();
    expect(heartbeat![1]!.startsWith("/run/alo-hosting/")).toBe(true);
  });

  it("sets DEPLOY_INLINE_WORKER=false so the panel does not also claim rows", () => {
    const unit = read(UNIT);
    expect(unit).toMatch(/^Environment=DEPLOY_INLINE_WORKER=false$/m);
  });

  it("sets NODE_ENV=production", () => {
    expect(read(UNIT)).toMatch(/^Environment=NODE_ENV=production$/m);
  });

  it("points ExecStart at a bundle the build produces", () => {
    const unit = read(UNIT);
    const exec = unit.match(/^ExecStart=\/usr\/bin\/node (.+)$/m);
    expect(exec).not.toBeNull();
    const target = exec![1]!;
    expect(target).toMatch(/deploy-worker\.cjs$/);

    // The build script must list that entrypoint. This is the check that would
    // have caught the unit pointing at a file `npm run build:worker` never made.
    const buildScript = read("scripts/build-automation-worker.mjs");
    expect(buildScript).toContain("scripts/deploy-worker.ts");
    expect(buildScript).toContain("deploy-worker.cjs");
  });

  // systemd-analyze verify needs a real systemd; it is absent in the build
  // sandbox. skipIf keeps the skip visible in the run summary instead of
  // passing a test that asserted nothing.
  it.skipIf(!hasSystemdAnalyze())(
    "is a valid unit file according to systemd's own parser",
    () => {
      let output = "";
      try {
        execFileSync("systemd-analyze", ["verify", UNIT], { encoding: "utf8", stdio: "pipe" });
      } catch (e) {
        // Non-zero exit is expected for missing dependencies; only a parse
        // error means the unit itself is malformed.
        output = String((e as { stderr?: string }).stderr ?? "");
      }
      expect(output).not.toMatch(/Unknown key|Invalid section|Failed to parse/);
    },
  );
});

describe("REL-03: the worker script honours the supervision contract", () => {
  const script = read(SCRIPT);

  it("drains on SIGTERM and SIGINT", () => {
    expect(script).toContain('process.on("SIGTERM"');
    expect(script).toContain('process.on("SIGINT"');
    expect(script).toContain("stopping");
  });

  it("writes a heartbeat every tick and on a timer", () => {
    expect(script).toContain("heartbeatFile");
    expect(script).toContain("setInterval");
    expect(script).toContain("updatedAt");
    // A tick must not leave the heartbeat saying "in tick" after it returns.
    expect(script).toContain("inTick = false");
  });

  it("does not exit the process on a failed tick", () => {
    // A poisoned deployment must not take the worker down for every tenant.
    expect(script).toContain("tick failed");
    // `process.exit(` would be an immediate kill; only a non-zero exitCode on a
    // crash is acceptable.
    expect(script).not.toMatch(/process\.exit\(/);
    expect(script).toContain("process.exitCode = 1");
  });

  it("clamps the poll interval instead of trusting the environment", () => {
    expect(script).toMatch(/Math\.min\(\s*60_000/);
    expect(script).toMatch(/Math\.max\(\s*500/);
  });

  it("defaults DEPLOY_INLINE_WORKER to false when unset, to match the unit", () => {
    expect(script).toMatch(/DEPLOY_INLINE_WORKER === undefined/);
  });

  it("supports a single-shot mode for smoke tests and cron", () => {
    expect(script).toContain('"--once"');
  });

  it("disconnects the database on shutdown", () => {
    expect(script).toContain("$disconnect");
  });
});

describe("REL-03: the Compose path is supervised too", () => {
  const compose = read("docker-compose.yml");

  it("defines a deploy-worker service", () => {
    expect(compose).toMatch(/^\s{2}deploy-worker:$/m);
    expect(compose).toContain("deploy-worker.cjs");
  });

  it("restarts it and gates it on the panel being healthy", () => {
    // Locate the deploy-worker block and inspect only that block, so a match in
    // another service cannot make this pass.
    const start = compose.indexOf("deploy-worker:");
    expect(start).toBeGreaterThan(-1);
    const block = compose.slice(start, compose.indexOf("\nvolumes:", start));
    expect(block).toContain("restart: unless-stopped");
    expect(block).toContain("condition: service_healthy");
    expect(block).toContain("stop_grace_period: 31m");
    expect(block).toContain("healthcheck:");
  });

  it("runs the container read-only with no new privileges", () => {
    const start = compose.indexOf("  deploy-worker:");
    const block = compose.slice(start, compose.indexOf("\nvolumes:", start));
    expect(block).toContain("read_only: true");
    expect(block).toContain("no-new-privileges:true");
    expect(block).toContain("cap_drop:");
  });

  it("gives the build a larger tmpfs than the automation worker", () => {
    // Builds write node_modules and a .next tree to $TMPDIR; 512m is enough for
    // orchestration JSON and not for a Next.js build.
    const start = compose.indexOf("  deploy-worker:");
    const block = compose.slice(start, compose.indexOf("\nvolumes:", start));
    expect(block).toMatch(/- \/tmp:size=(\d+)g/);
  });
});

describe("REL-03: CI refuses a unit whose bundle is missing", () => {
  const workflow = read(".github/workflows/ci-cd.yml");

  it("checks both standalone bundles exist", () => {
    expect(workflow).toContain("test -s .next/standalone/automation-worker.cjs");
    expect(workflow).toContain("test -s .next/standalone/deploy-worker.cjs");
  });

  it("syntax-checks both bundles", () => {
    expect(workflow).toContain("node --check .next/standalone/automation-worker.cjs");
    expect(workflow).toContain("node --check .next/standalone/deploy-worker.cjs");
  });

  it("cross-checks every shipped unit against the build output", () => {
    expect(workflow).toContain("deploy/systemd/*.service");
    expect(workflow).toContain("points at missing");
  });
});
