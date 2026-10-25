import { describe, it, expect } from "vitest";
import { detectFramework, memoryReader } from "../src/lib/deploy/detect";
import { parseCommand, configFromDetection } from "../src/lib/deploy/config";

const pkg = (extra: Record<string, unknown>) => JSON.stringify({ name: "fixture", version: "1.0.0", ...extra });

function assertCommandsSafe(d: Awaited<ReturnType<typeof detectFramework>>) {
  for (const command of [d.installCmd, d.lintCmd, d.typecheckCmd, d.testCmd, d.buildCmd, d.startCmd]) {
    if (command) expect(() => parseCommand(command)).not.toThrow();
  }
}

describe("framework detection from real-shaped manifests", () => {
  it("detects a plain static HTML site with high confidence and no build", async () => {
    const d = await detectFramework(memoryReader({ "index.html": "<h1>hello</h1>" }));
    expect(d.framework).toBe("static-html");
    expect(d.runtime).toBe("static");
    expect(d.outputDir).toBe(".");
    expect(d.buildCmd).toBeNull();
    expect(d.ambiguous).toBe(false);
    expect(d.confidence).toBe("high");
    assertCommandsSafe(d);
  });

  it("detects Next.js standalone and flags it as needing a service manager", async () => {
    const d = await detectFramework(memoryReader({
      "package.json": pkg({ dependencies: { next: "16.0.0", react: "19.0.0" }, scripts: { build: "next build", start: "next start", lint: "eslint ." } }),
      "package-lock.json": "{}",
      "next.config.ts": "export default { output: 'standalone', env: { X: process.env.SECRET_KEY } }",
      ".env.example": "NEXT_PUBLIC_API_URL=https://secret-value.example.com\nSECRET_KEY=do-not-leak\n",
      "src/app/api/health/route.ts": "export async function GET(){}",
    }));
    expect(d.framework).toBe("nextjs");
    expect(d.packageManager).toBe("npm");
    expect(d.installCmd).toBe("npm ci");
    expect(d.buildCmd).toBe("npm run build");
    expect(d.outputDir).toBe(".next/standalone");
    expect(d.healthPath).toBe("/api/health");
    expect(d.ambiguous).toBe(true);
    expect(d.envNames).toContain("NEXT_PUBLIC_API_URL");
    expect(d.envNames).toContain("SECRET_KEY");
    expect(d.envNames.join(" ")).not.toContain("do-not-leak");
    expect(d.envNames.join(" ")).not.toContain("secret-value.example.com");
    assertCommandsSafe(d);
  });

  it("detects Vite + yarn and produces a static dist bundle", async () => {
    const d = await detectFramework(memoryReader({
      "package.json": pkg({ devDependencies: { vite: "^6" }, scripts: { build: "vite build", test: "vitest run" } }),
      "yarn.lock": "",
      "vite.config.ts": "export default {}",
      "index.html": "<div id='root'></div>",
    }));
    expect(d.framework).toBe("vite");
    expect(d.packageManager).toBe("yarn");
    expect(d.installCmd).toBe("yarn install --frozen-lockfile");
    expect(d.buildCmd).toBe("yarn run build");
    expect(d.outputDir).toBe("dist");
    expect(d.ambiguous).toBe(false);
    assertCommandsSafe(d);
  });

  it("detects Express with a start script", async () => {
    const d = await detectFramework(memoryReader({
      "package.json": pkg({ dependencies: { express: "^4" }, scripts: { start: "node server.js" } }),
      "pnpm-lock.yaml": "",
    }));
    expect(d.framework).toBe("express");
    expect(d.packageManager).toBe("pnpm");
    expect(d.installCmd).toBe("pnpm install --frozen-lockfile");
    expect(d.startCmd).toBe("pnpm run start");
    assertCommandsSafe(d);
  });

  it("detects NestJS and requires operator confirmation", async () => {
    const d = await detectFramework(memoryReader({
      "package.json": pkg({ dependencies: { "@nestjs/core": "^10" }, scripts: { build: "nest build" } }),
      "nest-cli.json": "{}",
      "pnpm-lock.yaml": "",
    }));
    expect(d.framework).toBe("nestjs");
    expect(d.outputDir).toBe("dist");
    expect(d.ambiguous).toBe(true);
    assertCommandsSafe(d);
  });

  it("detects a Bun project from bun.lockb", async () => {
    const d = await detectFramework(memoryReader({
      "package.json": pkg({ scripts: { build: "bun build ./index.ts --outdir ./dist" } }),
      "bun.lockb": "",
    }));
    expect(d.packageManager).toBe("bun");
    expect(d.installCmd).toBe("bun install --frozen-lockfile");
    expect(d.buildCmd).toBe("bun run build");
    assertCommandsSafe(d);
  });

  it("detects Laravel / Composer without guessing artisan migrations", async () => {
    const d = await detectFramework(memoryReader({
      "composer.json": JSON.stringify({ require: { "laravel/framework": "^11" } }),
      "artisan": "",
      "composer.lock": "",
    }));
    expect(d.framework).toBe("laravel");
    expect(d.language).toBe("php");
    expect(d.installCmd).toBe("composer install --no-dev --optimize-autoloader");
    expect(d.buildCmd).toBeNull();
    expect(d.ambiguous).toBe(true);
    expect(d.warnings.join(" ")).toMatch(/migrations/i);
    assertCommandsSafe(d);
  });

  it("detects Django and FastAPI from dependency manifests", async () => {
    const django = await detectFramework(memoryReader({ "requirements.txt": "Django==5.0\n", "manage.py": "" }));
    expect(django.framework).toBe("django");
    expect(django.runtime).toBe("python3");
    expect(django.ambiguous).toBe(true);
    assertCommandsSafe(django);

    const fastapi = await detectFramework(memoryReader({ "pyproject.toml": "[project]\ndependencies = [\"fastapi\"]\n" }));
    expect(fastapi.framework).toBe("fastapi");
    expect(fastapi.ambiguous).toBe(true);
    assertCommandsSafe(fastapi);
  });

  it("detects Docker/Compose and refuses to guess a build command", async () => {
    const d = await detectFramework(memoryReader({ "Dockerfile": "FROM node:22\n", "docker-compose.yml": "services: {}\n" }));
    expect(d.framework).toBe("docker-compose");
    expect(d.buildCmd).toBeNull();
    expect(d.ambiguous).toBe(true);
    assertCommandsSafe(d);
  });

  it("reports unknown manifests as ambiguous", async () => {
    const d = await detectFramework(memoryReader({ "README.md": "# hello" }));
    expect(d.framework).toBe("unknown");
    expect(d.ambiguous).toBe(true);
    expect(d.confidence).toBe("low");
  });

  it("turns detection into a validated, editable config", async () => {
    const d = await detectFramework(memoryReader({ "index.html": "<h1>x</h1>" }));
    const config = configFromDetection(d);
    expect(config.version).toBe(1);
    expect(config.outputDir).toBe(".");
    expect(config.requiresApproval).toBe(false);
    expect(config.serviceManager).toBe("static");
  });
});
