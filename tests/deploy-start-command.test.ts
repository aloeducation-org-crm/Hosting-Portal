import { describe, it, expect } from "vitest";
import {
  analyseStartScript,
  resolveNodeStartCommand,
  isSafeEntryPath,
  NEXT_STANDALONE_SERVER,
} from "../src/lib/deploy/start-command";
import { parseCommand } from "../src/lib/deploy/config";

/**
 * Regression cover for the 2026-10-27 incident.
 *
 * Both dead sites declared exactly this:
 *   "start": "NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log"
 *
 * Under PM2 that produced `sh: 1: bun: not found` and
 * `Cannot find module '.../.next/standalone/server.js'`, both as crash-loops.
 */

const INCIDENT_START = "NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log";

describe("start script analysis", () => {
  it("splits the incident script into runtime, entry and shell plumbing", () => {
    const analysis = analyseStartScript(INCIDENT_START);
    expect(analysis.executable).toBe("bun");
    expect(analysis.entry).toBe(".next/standalone/server.js");
    expect(analysis.env).toEqual({ NODE_ENV: "production" });
    expect(analysis.argv).toEqual(["bun", ".next/standalone/server.js"]);
    expect(analysis.shellOperators).toEqual(expect.arrayContaining(["|", ">", "&"]));
  });

  it("drops everything after the first shell operator", () => {
    const analysis = analyseStartScript("node server.js && echo done");
    expect(analysis.argv).toEqual(["node", "server.js"]);
    expect(analysis.shellOperators).toContain("&&");
  });

  it("tolerates quoting and empty input without throwing", () => {
    // A path containing a space is parsed but rejected as an executable entry.
    expect(analyseStartScript("node \"my server.js\"").entry).toBeNull();
    expect(analyseStartScript(null).executable).toBeNull();
    expect(analyseStartScript("   ").argv).toEqual([]);
  });
});

describe("Next.js start command resolution", () => {
  it("rewrites a bun+pipeline start script into an argv node command", () => {
    const resolved = resolveNodeStartCommand({ startScript: INCIDENT_START, standalone: true });
    expect(resolved.startCmd).toBe(`node ${NEXT_STANDALONE_SERVER}`);
    expect(resolved.entry).toBe(NEXT_STANDALONE_SERVER);
    expect(resolved.runtime).toBe("node");
    expect(resolved.warnings.join(" ")).toMatch(/shell plumbing/i);
    expect(resolved.warnings.join(" ")).toMatch(/bun/i);
  });

  it("never returns a command the deploy validator would reject", () => {
    const scripts = [
      INCIDENT_START,
      "next start",
      "node server.js",
      "bun run start",
      "node .next/standalone/server.js",
      "bash -c 'node x.js'",
      "../../evil.js",
      "node ../../evil.js",
      "",
      null,
    ];
    for (const startScript of scripts) {
      for (const standalone of [true, false]) {
        const { startCmd } = resolveNodeStartCommand({ startScript, standalone });
        expect(() => parseCommand(startCmd)).not.toThrow();
        expect(startCmd).not.toMatch(/[|&;<>`$]/);
      }
    }
  });

  it("uses the nested bundle path when tracing resolved a workspace root", () => {
    const resolved = resolveNodeStartCommand({
      startScript: INCIDENT_START,
      standalone: true,
      standaloneEntry: ".next/standalone/alo-learning/server.js",
    });
    expect(resolved.startCmd).toBe("node .next/standalone/alo-learning/server.js");
  });

  it("refuses to trust a start script that points outside the release", () => {
    const resolved = resolveNodeStartCommand({
      startScript: "node ../../../../../usr/local/bin/evil.js",
      standalone: true,
    });
    expect(resolved.startCmd).toBe(`node ${NEXT_STANDALONE_SERVER}`);
  });

  it("keeps an explicit node entry for non-standalone builds", () => {
    const resolved = resolveNodeStartCommand({ startScript: "node server.js", standalone: false });
    expect(resolved.startCmd).toBe("node server.js");
  });

  it("falls back to `npx next start` when standalone output is not configured", () => {
    const resolved = resolveNodeStartCommand({ startScript: "next start", standalone: false });
    expect(resolved.startCmd).toBe("npx next start");
  });

  it("defaults to the standalone server when there is no start script", () => {
    expect(resolveNodeStartCommand({ startScript: null, standalone: true }).startCmd).toBe(
      `node ${NEXT_STANDALONE_SERVER}`,
    );
  });
});

describe("entry path safety", () => {
  it("accepts relative javascript entries only", () => {
    expect(isSafeEntryPath(".next/standalone/server.js")).toBe(true);
    expect(isSafeEntryPath("dist/main.cjs")).toBe(true);
    expect(isSafeEntryPath("/etc/passwd.js")).toBe(false);
    expect(isSafeEntryPath("../server.js")).toBe(false);
    expect(isSafeEntryPath("server.js; rm -rf /")).toBe(false);
    expect(isSafeEntryPath("server.sh")).toBe(false);
  });
});
