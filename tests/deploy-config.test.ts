import { describe, it, expect } from "vitest";
import { parseCommand, tokenize, validateDeployConfig, UnsafeCommandError, filterBuildEnv } from "../src/lib/deploy/config";
import { redact, collectSecrets, redactCommand } from "../src/lib/deploy/redact";
import { verifyGitHubSignature } from "../src/lib/deploy/signature";

describe("command allowlist (no arbitrary shell execution)", () => {
  it("accepts argv-only framework commands", () => {
    expect(parseCommand("npm ci")).toEqual(["npm", "ci"]);
    expect(parseCommand("pnpm install --frozen-lockfile")).toEqual(["pnpm", "install", "--frozen-lockfile"]);
    expect(parseCommand("python3 -m pip install -r requirements.txt")).toEqual(["python3", "-m", "pip", "install", "-r", "requirements.txt"]);
    expect(parseCommand("npm run build -- --mode production")).toEqual(["npm", "run", "build", "--", "--mode", "production"]);
    expect(tokenize('echo "two words"')).toEqual(["echo", "two words"]);
  });

  it("rejects shell metacharacters, chains, redirects and globs", () => {
    for (const bad of [
      "npm run build && curl http://evil",
      "npm ci; rm -rf /",
      "npm run build | tee /tmp/out",
      "npm run `whoami`",
      "npm run build > /etc/passwd",
      "npm run $(id)",
      "sh -c 'anything'",
    ]) {
      expect(() => parseCommand(bad), bad).toThrow(UnsafeCommandError);
    }
  });

  it("rejects inline evaluation, absolute paths and traversal", () => {
    expect(() => parseCommand("node -e process.exit(1)")).toThrow(/evaluation/i);
    expect(() => parseCommand("python3 -c 'print(1)'")).toThrow(/evaluation/i);
    expect(() => parseCommand("npm --prefix /etc run build")).toThrow(/Absolute/);
    expect(() => parseCommand("npm run ../../bin/evil")).toThrow(/traversing|script name/i);
  });

  it("rejects a non-allowlisted executable", () => {
    expect(() => parseCommand("curl https://example.com")).toThrow(/not allowed/);
    expect(() => parseCommand("bash script.sh")).toThrow(/not allowed/);
  });

  it("validates the whole config and blocks unsafe outputDir", () => {
    expect(() => validateDeployConfig({ outputDir: "../../etc" })).toThrow(/outputDir/);
    expect(() => validateDeployConfig({ outputDir: "/etc" })).toThrow(/outputDir/);
    expect(() => validateDeployConfig({ buildCmd: "rm -rf /" })).toThrow(/not allowed/);
    expect(() => validateDeployConfig({ serviceManager: "pm2" })).toThrow(/serviceName/);
    expect(() => validateDeployConfig({ buildEnvFile: "/etc/passwd" })).toThrow(/DEPLOY_ENV_FILE_BASE/);
    process.env.DEPLOY_ENV_FILE_BASE = "/etc/alo-hosting/build-env";
    expect(validateDeployConfig({ buildEnvFile: "/etc/alo-hosting/build-env/app.env" }).buildEnvFile).toBe("/etc/alo-hosting/build-env/app.env");
    expect(() => validateDeployConfig({ buildEnvFile: "/etc/passwd" })).toThrow(/DEPLOY_ENV_FILE_BASE/);
    delete process.env.DEPLOY_ENV_FILE_BASE;
    const config = validateDeployConfig({ buildCmd: "npm run build", outputDir: "dist", envNames: ["API_URL"] });
    expect(config.buildCmd).toBe("npm run build");
    expect(config.port).toBe(3100);
  });

  it("only passes explicitly named build variables", () => {
    const filtered = filterBuildEnv({ API_URL: "https://x", SECRET_TOKEN: "nope" }, ["API_URL"]);
    expect(filtered).toEqual({ API_URL: "https://x" });
  });
});

describe("log redaction", () => {
  it("masks registered secret values and credential shapes", () => {
    const secret = "ghp_" + "A".repeat(30);
    process.env.GITHUB_TOKEN = secret;
    const text = `token=${secret} key=sk-super-secret-value bearer ${secret} url=https://x-access-token:${secret}@github.com/o/r.git`;
    const out = redact(text);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
    expect(collectSecrets().length).toBeGreaterThan(0);
    delete process.env.GITHUB_TOKEN;
  });

  it("redacts clone-url credentials in logged commands", () => {
    const out = redactCommand(["git", "clone", "https://x-access-token:abc123@github.com/o/r.git", "/tmp/build"]);
    expect(out).not.toContain("abc123");
  });
});

describe("webhook signature", () => {
  const body = JSON.stringify({ ref: "refs/heads/main" });
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const signature = `sha256=${crypto.createHmac("sha256", "s3cret").update(body).digest("hex")}`;

  it("accepts a valid HMAC-SHA256 signature", () => {
    expect(verifyGitHubSignature(body, signature, "s3cret")).toBe(true);
  });

  it("rejects a wrong secret, wrong body, missing header and truncated digest", () => {
    expect(verifyGitHubSignature(body, signature, "other")).toBe(false);
    expect(verifyGitHubSignature(body + " ", signature, "s3cret")).toBe(false);
    expect(verifyGitHubSignature(body, null, "s3cret")).toBe(false);
    expect(verifyGitHubSignature(body, "sha256=abcd", "s3cret")).toBe(false);
    expect(verifyGitHubSignature(body, "", "")).toBe(false);
  });
});
