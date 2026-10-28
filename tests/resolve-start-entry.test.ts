import { describe, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * The shell entry points (`deploy-new-site.sh`, `repair-nextjs-site.sh`) must
 * never do string surgery on `scripts.start`; they delegate to this CLI. These
 * tests pin the contract they rely on, including the two shapes that took
 * production sites down.
 */

const execFileAsync = promisify(execFile);
const CLI = path.join(__dirname, "..", "scripts", "resolve-start-entry.mjs");
const INCIDENT_START = "NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log";

const tempDirs: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alo-resolve-"));
  tempDirs.push(dir);
  for (const [rel, contents] of Object.entries(files)) {
    const target = path.join(dir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  return dir;
}

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("resolve-start-entry CLI", () => {
  it("resolves the incident manifest to a node argv command and stages assets", async () => {
    const dir = await fixture({
      "package.json": JSON.stringify({ name: "marketingos", scripts: { start: INCIDENT_START } }),
      "next.config.js": "module.exports = { output: 'standalone' }",
      ".next/standalone/server.js": "// server",
      ".next/static/chunks/app.css": "body{}",
      "public/robots.txt": "user-agent: *",
    });
    const { code, stdout } = await run(["--dir", dir, "--json", "--stage-assets"]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("standalone");
    expect(result.entry).toBe(".next/standalone/server.js");
    expect(result.startCmd).toBe("node .next/standalone/server.js");
    expect(result.warnings.join(" ")).toMatch(/shell plumbing/i);
    // `next build` never copies these into the bundle; without them every asset 404s.
    expect(result.stagedAssets).toEqual(expect.arrayContaining([".next/static", "public"]));
    await expect(fs.stat(path.join(dir, ".next/standalone/.next/static/chunks/app.css"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(dir, ".next/standalone/public/robots.txt"))).resolves.toBeTruthy();
  });

  it("finds a nested standalone bundle instead of trusting the manifest path", async () => {
    const dir = await fixture({
      "package.json": JSON.stringify({ name: "learn", scripts: { start: INCIDENT_START } }),
      "next.config.ts": "export default { output: 'standalone' }",
      ".next/standalone/alo-learning/server.js": "// server",
    });
    const { code, stdout } = await run(["--dir", dir, "--json"]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.entry).toBe(".next/standalone/alo-learning/server.js");
    expect(result.warnings.join(" ")).toMatch(/outputFileTracingRoot/);
  });

  it("fails loudly when the build produced nothing to run", async () => {
    const dir = await fixture({
      "package.json": JSON.stringify({ name: "broken", scripts: { start: INCIDENT_START } }),
      "next.config.ts": "export default { output: 'standalone' }",
    });
    const { code, stderr } = await run(["--dir", dir]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/does not exist in the build output|no runnable/i);
  });

  it("writes an ecosystem file with an argv script, never a shell string", async () => {
    const dir = await fixture({
      "package.json": JSON.stringify({ name: "site", scripts: { start: INCIDENT_START } }),
      "next.config.js": "module.exports = { output: 'standalone' }",
      ".next/standalone/server.js": "// server",
    });
    const ecosystem = path.join(dir, "ecosystem.alo.cjs");
    const { code } = await run(["--dir", dir, "--port", "3061", "--name", "marketingos", "--write-ecosystem", ecosystem]);
    expect(code).toBe(0);
    const contents = await fs.readFile(ecosystem, "utf8");
    expect(contents).toContain('script: ".next/standalone/server.js"');
    expect(contents).toContain('name: "marketingos"');
    expect(contents).toContain('PORT: "3061"');
    expect(contents).toContain('interpreter: "node"');
    expect(contents).not.toMatch(/tee|\|/);
  });

  it("keeps a plain node server project working", async () => {
    const dir = await fixture({
      "package.json": JSON.stringify({ name: "api", scripts: { start: "node dist/main.js" } }),
      "dist/main.js": "// server",
    });
    const { code, stdout } = await run(["--dir", dir, "--json"]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.mode).toBe("server");
    expect(result.startCmd).toBe("node dist/main.js");
  });
});
