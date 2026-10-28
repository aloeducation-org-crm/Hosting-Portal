/**
 * Phase 2 — one-time agent bootstrap installer (§6).
 *
 * Runs the real `scripts/install-agent.sh` in a throwaway HOME and verifies
 * the contract that matters on production hosts:
 *   - --dry-run detects the host and emits a JSON plan while writing NOTHING;
 *   - a real run refuses (exit 2) without an enrollment token, before any write;
 *   - an existing agent install is refused without --force (exit 4) and its
 *     state file is left byte-identical;
 *   - the plan reports every detection category the spec requires.
 *
 * No network calls: only dry-run and refusal paths are exercised here. Real
 * enrollment against a panel is intentionally left to the on-host procedure
 * and is reported as not-verified in the audit.
 */
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve("scripts/install-agent.sh");
const created: string[] = [];

function makeHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-agent-home-"));
  created.push(dir);
  return dir;
}

function run(
  args: string[],
  home: string,
  env: Record<string, string> = {}
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bash", [SCRIPT, ...args], {
      env: { ...process.env, HOME: home, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function fileCount(dir: string): number {
  let n = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      n += 1;
      if (entry.isDirectory()) walk(path.join(d, entry.name));
    }
  };
  walk(dir);
  return n;
}

afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

describe("install-agent.sh --dry-run", () => {
  it("emits a complete JSON plan and writes nothing", () => {
    const home = makeHome();
    const res = run(
      ["--dry-run", "--panel-url", "https://hosting.alolabs.net", "--name", "office-b"],
      home
    );
    expect(res.status).toBe(0);
    const plan = JSON.parse(res.stdout) as {
      action: string;
      writesPerformed: boolean;
      host: Record<string, unknown>;
      steps: Array<{ name: string; status: string; detail: string }>;
      nextSteps: string[];
    };
    expect(plan.action).toBe("dry-run");
    expect(plan.writesPerformed).toBe(false);
    expect(plan.host.osPretty).toBeTruthy();
    expect(plan.host.arch).toBeTruthy();
    expect(plan.host.nodeVersion).toBeTruthy();
    expect(typeof plan.host.dockerPresent).toBe("boolean");
    expect(plan.host.existingAgent).toBe(false);

    const names = plan.steps.map((s) => s.name);
    for (const required of [
      "os-architecture",
      "node-runtime",
      "disk-space",
      "container-runtime",
      "existing-services",
      "listening-ports",
      "agent-install",
    ]) {
      expect(names, required).toContain(required);
    }
    for (const s of plan.steps) {
      expect(["ok", "skipped", "failed"]).toContain(s.status);
      expect(s.detail.length).toBeGreaterThan(0);
    }
    // The hard promise: not one byte written.
    expect(fileCount(home)).toBe(0);
  });

  it("detects and preserves an existing agent install", () => {
    const home = makeHome();
    fs.mkdirSync(path.join(home, ".alo-agent"), { recursive: true });
    fs.writeFileSync(path.join(home, ".alo-agent", "agent.json"), '{"existing":true}');
    const res = run(["--dry-run", "--panel-url", "https://x.example.com", "--name", "b"], home);
    expect(res.status).toBe(0);
    const plan = JSON.parse(res.stdout) as {
      host: { existingAgent: boolean };
      steps: Array<{ name: string; detail: string }>;
    };
    expect(plan.host.existingAgent).toBe(true);
    const step = plan.steps.find((s) => s.name === "agent-install");
    expect(step!.detail).toContain("preserved");
    // Dry run must not back up, rotate or touch the existing state.
    expect(fileCount(home)).toBe(2); // .alo-agent/ + agent.json
    expect(fs.readFileSync(path.join(home, ".alo-agent", "agent.json"), "utf8")).toBe('{"existing":true}');
  });
});

describe("install-agent.sh real-run gates (no writes before approval)", () => {
  it("refuses without an enrollment token and writes nothing", () => {
    const home = makeHome();
    const res = run(["--panel-url", "https://hosting.alolabs.net", "--name", "office-b"], home);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("ALO_ENROLL_TOKEN");
    expect(fileCount(home)).toBe(0);
  });

  it("refuses without --panel-url/--name and writes nothing", () => {
    const home = makeHome();
    const res = run(["--name", "office-b"], home, {
      ALO_ENROLL_TOKEN: "alo_enroll_test",
    });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("--panel-url");
    expect(fileCount(home)).toBe(0);
  });

  it("refuses to overwrite an existing install without --force, leaving it intact", () => {
    const home = makeHome();
    const stateDir = path.join(home, ".alo-agent");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "agent.json"), '{"existing":"do-not-touch"}');
    fs.writeFileSync(path.join(stateDir, "alo-agent.mjs"), "// old agent binary");
    const res = run(
      ["--panel-url", "https://hosting.alolabs.net", "--name", "office-b"],
      home,
      { ALO_ENROLL_TOKEN: "alo_enroll_never_used" }
    );
    expect(res.status).toBe(4);
    expect(res.stderr).toContain("--force");
    expect(fs.readFileSync(path.join(stateDir, "agent.json"), "utf8")).toBe('{"existing":"do-not-touch"}');
    expect(fs.readFileSync(path.join(stateDir, "alo-agent.mjs"), "utf8")).toBe("// old agent binary");
    expect(fileCount(home)).toBe(3); // .alo-agent/ + 2 files, nothing new
  });

  it("rejects unknown arguments with a usage error", () => {
    const home = makeHome();
    const res = run(["--format", "json"], home);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("unknown argument");
    expect(fileCount(home)).toBe(0);
  });
});
