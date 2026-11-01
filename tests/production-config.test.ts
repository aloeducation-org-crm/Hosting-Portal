/**
 * The redacted production-configuration report.
 *
 * Two things are being protected here, and they are different in kind:
 *
 *  1. TRUTH — the report has to describe the host as it is. A configuration that
 *     points the database inside the Git checkout, binds customer sites to a
 *     public interface, allows anonymous AI use or exposes a session secret
 *     through a NEXT_PUBLIC_ variable must be reported as an error, not smoothed
 *     over. A release gate that cannot fail is decoration.
 *
 *  2. REDACTION — the report must be safe to paste into a ticket, a CI log or an
 *     incident review. That is asserted the only way it can be asserted: by
 *     putting distinctive values in the environment and proving none of them
 *     appear anywhere in the output.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { classifySecret, validateProductionConfig } from "@/lib/config/production-config";

const REPO = process.cwd();
const CLI = path.join(REPO, "scripts/validate-prod-config.mjs");

/** Distinctive, unmistakable secrets: if any of these leak, the test sees it. */
const SECRETS = {
  NEXTAUTH_SECRET: "nextauth-secret-DO-NOT-LEAK-0123456789abcdef",
  JWT_SECRET: "jwt-secret-DO-NOT-LEAK-0123456789abcdef",
  APP_ENCRYPTION_KEY: "encryption-key-DO-NOT-LEAK-0123456789abcdef",
  INTERNAL_SECRET: "internal-secret-DO-NOT-LEAK-0123456789abcdef",
};
const SECRET_VALUES = Object.values(SECRETS);

/** The documented production baseline, with real (fake) secrets. */
function baseline(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    PORT: "3051",
    APP_URL: "https://hosting.alolabs.net",
    NEXT_PUBLIC_APP_URL: "https://hosting.alolabs.net",
    NEXTAUTH_URL: "https://hosting.alolabs.net",
    DATABASE_URL: "file:/var/lib/alo-hosting/hosting.db",
    LOG_LEVEL: "info",
    MAX_UPLOAD_SIZE_MB: "50",
    RATE_LIMIT_WINDOW_MS: "60000",
    RATE_LIMIT_MAX_REQUESTS: "100",
    ALO_BACKUP_DIR: "/home/alamin/backups",
    ALO_SITES_DIR: "/home/alamin/sites",
    ALO_NGINX_DIR: "/etc/nginx",
    ALO_NGINX_ENABLED_DIR: "/etc/nginx/sites-enabled",
    ALO_HELPER_DIR: "/home/alamin/Hosting-Portal/scripts",
    ALO_CERTBOT_EMAIL: "admin@alolabs.net",
    AI_ALLOW_ANONYMOUS: "false",
    AI_FREE_ONLY: "true",
    AI_PROVIDER: "none",
    AI_PROVIDER_ORDER: "none",
    ALLOW_INSECURE_WEBHOOK_HTTP: "false",
    ALLOW_PREVIEW_EMBED: "false",
    DNS_PROVIDER_MODE: "none",
    SSO_ENABLED: "false",
    DEPLOY_BIND_HOST: "127.0.0.1",
    DEPLOY_RELEASE_BASE: "/home/alamin/releases",
    DEPLOY_ALLOW_LOCAL_SOURCE: "false",
    DEPLOY_DISABLE_BOOT_RESTORE: "true",
    CORS_ALLOWED_ORIGINS: "https://hosting.alolabs.net",
    ...SECRETS,
    ...overrides,
  };
}

const keysOf = (report: { findings: Array<{ key: string; severity: string }> }, severity?: string) =>
  report.findings.filter((f) => !severity || f.severity === severity).map((f) => f.key);

describe("production configuration report", () => {
  it("passes the documented baseline and reports AI as not configured", () => {
    const report = validateProductionConfig(baseline());

    expect(report.counts.errors).toBe(0);
    expect(keysOf(report, "error")).toEqual([]);
    expect(report.ok).toBe(true);

    // AI_PROVIDER=none is a supported state, and it is reported as such — never
    // as "healthy", and never silently.
    expect(report.facts.ai).toMatchObject({ state: "not-configured", freeOnly: true, allowAnonymous: false });
    expect(keysOf(report, "info")).toContain("AI_PROVIDER");
    // DNS automation is equally honest about not being configured.
    expect(keysOf(report, "info")).toContain("DNS_PROVIDER_MODE");
    expect(report.facts.flags).toMatchObject({
      ALLOW_INSECURE_WEBHOOK_HTTP: false,
      ALLOW_PREVIEW_EMBED: false,
      DEPLOY_ALLOW_LOCAL_SOURCE: false,
      SSO_ENABLED: false,
    });
    expect(report.facts.application).toMatchObject({ port: 3051, https: true, urlsAgree: true });
    expect(report.facts.database).toMatchObject({ scheme: "file", absolute: true });
  });

  it("never emits a secret value, a database URL or a connection string", () => {
    const databaseUrl = "file:/var/lib/alo-hosting/hosting.db";
    const report = validateProductionConfig(
      baseline({
        DATABASE_URL: databaseUrl,
        OPENAI_API_KEY: "sk-proj-DO-NOT-LEAK-0123456789abcdef",
        CORS_ALLOWED_ORIGINS: "https://hosting.alolabs.net",
      }),
    );

    const serialized = JSON.stringify(report);
    for (const value of SECRET_VALUES) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain("sk-proj-DO-NOT-LEAK");
    // The database is described structurally, never quoted. Reporting the path
    // would be a connection-string disclosure by another name.
    expect(serialized).not.toContain(databaseUrl);
    expect(serialized).not.toContain("/var/lib/alo-hosting");
    // What is allowed to appear: public hostnames and booleans.
    expect(serialized).toContain("hosting.alolabs.net");
  });

  it("refuses a database that lives inside the Git checkout, unless that risk was accepted", () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-cfg-app-"));
    try {
      const inside = `file:${appDir}/prisma/db/hosting.db`;

      const refused = validateProductionConfig(baseline({ DATABASE_URL: inside }), { appDir });
      expect(refused.ok).toBe(false);
      expect(refused.facts.database.insideCheckout).toBe(true);
      expect(keysOf(refused, "error")).toContain("DATABASE_URL");
      expect(refused.findings.find((f) => f.key === "DATABASE_URL")?.message).toContain(
        "a checkout reset would destroy live data",
      );

      // ALLOW_DB_IN_CHECKOUT=1 is the documented, explicit acceptance: it becomes
      // a warning rather than a hard stop, so an operator is not deadlocked.
      const accepted = validateProductionConfig(
        baseline({ DATABASE_URL: inside, ALLOW_DB_IN_CHECKOUT: "1" }),
        { appDir },
      );
      expect(accepted.ok).toBe(true);
      const finding = accepted.findings.find((f) => f.key === "DATABASE_URL");
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("ALLOW_DB_IN_CHECKOUT");

      // And a database outside the tree is simply fine.
      const outside = validateProductionConfig(baseline({ DATABASE_URL: "file:/var/lib/alo-hosting/x.db" }), { appDir });
      expect(outside.facts.database.insideCheckout).toBe(false);
      expect(outside.ok).toBe(true);
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true });
    }
  });

  it("rejects a relative SQLite path and an unsupported scheme", () => {
    for (const url of ["file:./db/custom.db", "file:db/hosting.db"]) {
      const report = validateProductionConfig(baseline({ DATABASE_URL: url }));
      expect(report.ok, url).toBe(false);
      expect(report.facts.database.absolute).toBe(false);
      expect(keysOf(report, "error")).toContain("DATABASE_URL");
    }

    const unsupported = validateProductionConfig(baseline({ DATABASE_URL: "mysql://user:pw@db/app" }));
    expect(unsupported.ok).toBe(false);
    expect(JSON.stringify(unsupported)).not.toContain("pw@db");

    // PostgreSQL is not silently accepted as equivalent to the shipped SQLite
    // deployment, but it is not an error either — it is a deviation to verify.
    const postgres = validateProductionConfig(baseline({ DATABASE_URL: "postgresql://app@db/app" }));
    expect(postgres.ok).toBe(true);
    expect(postgres.findings.find((f) => f.key === "DATABASE_URL")?.severity).toBe("warning");
  });

  it("rejects application URLs that disagree, or that are not https in production", () => {
    const disagree = validateProductionConfig(baseline({ NEXTAUTH_URL: "https://panel.example.com" }));
    expect(disagree.ok).toBe(false);
    expect(disagree.facts.application.urlsAgree).toBe(false);

    const insecure = validateProductionConfig(baseline({ APP_URL: "http://hosting.alolabs.net" }));
    expect(insecure.ok).toBe(false);
    expect(insecure.findings.some((f) => f.key === "APP_URL" && f.message.includes("https"))).toBe(true);

    const missing = validateProductionConfig(baseline({ NEXT_PUBLIC_APP_URL: "" }));
    expect(missing.ok).toBe(false);
    expect(keysOf(missing, "error")).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("rejects a server secret that reaches the browser through NEXT_PUBLIC_*", () => {
    const leaked = validateProductionConfig(
      baseline({ NEXT_PUBLIC_BOOTSTRAP: SECRETS.NEXTAUTH_SECRET }),
    );
    expect(leaked.ok).toBe(false);
    expect(leaked.findings.find((f) => f.key === "NEXT_PUBLIC_BOOTSTRAP")?.message).toContain(
      "same value as a server secret",
    );

    const named = validateProductionConfig(baseline({ NEXT_PUBLIC_API_SECRET: "something-else-entirely" }));
    expect(named.ok).toBe(false);
    expect(named.findings.find((f) => f.key === "NEXT_PUBLIC_API_SECRET")?.message).toContain(
      "compiled into the browser bundle",
    );
  });

  it("rejects the hardening flags that must stay off", () => {
    const report = validateProductionConfig(
      baseline({
        ALLOW_INSECURE_WEBHOOK_HTTP: "true",
        ALLOW_PREVIEW_EMBED: "true",
        DEPLOY_ALLOW_LOCAL_SOURCE: "true",
        CORS_ALLOWED_ORIGINS: "*",
        DEPLOY_BIND_HOST: "0.0.0.0",
        AI_ALLOW_ANONYMOUS: "true",
      }),
    );

    expect(report.ok).toBe(false);
    const errors = keysOf(report, "error");
    for (const key of [
      "ALLOW_INSECURE_WEBHOOK_HTTP",
      "ALLOW_PREVIEW_EMBED",
      "DEPLOY_ALLOW_LOCAL_SOURCE",
      "CORS_ALLOWED_ORIGINS",
      "DEPLOY_BIND_HOST",
      "AI_ALLOW_ANONYMOUS",
    ]) {
      expect(errors, key).toContain(key);
    }
  });

  it("reports SSO and boot-restore posture as warnings instead of silence", () => {
    const report = validateProductionConfig(
      baseline({ SSO_ENABLED: "true", DEPLOY_DISABLE_BOOT_RESTORE: "false" }),
    );
    expect(report.counts.warnings).toBeGreaterThanOrEqual(2);
    expect(keysOf(report, "warning")).toContain("SSO_ENABLED");
    expect(keysOf(report, "warning")).toContain("DEPLOY_DISABLE_BOOT_RESTORE");
  });

  it("classifies secret values without retaining them", () => {
    expect(classifySecret(undefined)).toBe("unset");
    expect(classifySecret("")).toBe("unset");
    expect(classifySecret("change-me-internal-secret")).toBe("placeholder");
    expect(classifySecret("ci-only-not-a-real-secret-0123456789abcdef")).toBe("placeholder");
    expect(classifySecret("short")).toBe("weak");
    expect(classifySecret("x".repeat(32))).toBe("set");
  });
});

describe("validate-prod-config CLI", () => {
  it("prints the redacted report and exits 0 for the documented baseline", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-cfg-cli-"));
    try {
      const envFile = path.join(dir, "panel.env");
      const lines = Object.entries(baseline())
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${value}`);
      fs.writeFileSync(envFile, `${lines.join("\n")}\n`);

      const out = execFileSync(process.execPath, [CLI, "--env-file", envFile], {
        encoding: "utf8",
        // A deliberately empty environment: the file must be the only source.
        env: { PATH: process.env.PATH ?? "" },
      });
      const report = JSON.parse(out) as { ok: boolean; facts: { ai: { state: string } }; envFile: string };
      expect(report.ok).toBe(true);
      expect(report.facts.ai.state).toBe("not-configured");
      expect(report.envFile).toBe(envFile);
      for (const value of SECRET_VALUES) expect(out).not.toContain(value);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails with exit 1 when the configuration has an error", () => {
    const result = (() => {
      try {
        const stdout = execFileSync(process.execPath, [CLI], {
          encoding: "utf8",
          env: { PATH: process.env.PATH ?? "", DATABASE_URL: "file:./relative.db" },
        });
        return { status: 0, stdout };
      } catch (error) {
        const e = error as { status?: number; stdout?: string };
        return { status: e.status ?? 1, stdout: e.stdout ?? "" };
      }
    })();
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).ok).toBe(false);
  });

  it("parses an env file instead of executing it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-cfg-hostile-"));
    try {
      const canary = path.join(dir, "pwned");
      const envFile = path.join(dir, "panel.env");
      fs.writeFileSync(
        envFile,
        [
          `WEIRD=$(touch ${canary})`,
          `BACKTICKS=\`touch ${canary}\``,
          // Quoted on purpose: the parser must unwrap the quotes, not eval them.
          "APP_URL=\"https://hosting.alolabs.net\"",
          "NEXT_PUBLIC_APP_URL=https://hosting.alolabs.net",
          "PORT=3051",
        ].join("\n") + "\n",
      );

      let stdout = "";
      try {
        stdout = execFileSync(process.execPath, [CLI, "--env-file", envFile], {
          encoding: "utf8",
          env: { PATH: process.env.PATH ?? "" },
        });
      } catch (error) {
        stdout = (error as { stdout?: string }).stdout ?? "";
      }

      // The canary proves nothing was executed; the quoted value proves the file
      // was actually parsed.
      expect(fs.existsSync(canary)).toBe(false);
      expect(stdout).not.toContain(canary);
      expect(stdout).toContain("hosting.alolabs.net");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
