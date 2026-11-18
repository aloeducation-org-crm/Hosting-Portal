import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const repo = path.resolve(__dirname, "..");
const { parsePanelEnv, readPanelEnv } = require("../deploy/pm2/panel-env.cjs") as {
  parsePanelEnv: (text: string) => Record<string, string>;
  readPanelEnv: (file: string) => Record<string, string>;
};

type App = { name: string; script: string; cwd: string; exec_mode: string; env: Record<string, string> };

const ecosystemPath = path.join(repo, "deploy/pm2/ecosystem.config.cjs");
const overrides = ["PANEL_ENV_FILE", "PANEL_APP_DIR", "PANEL_PORT"] as const;
const temporary: string[] = [];

function loadEcosystem(env: Partial<Record<(typeof overrides)[number], string>>): App[] {
  for (const key of overrides) delete process.env[key];
  Object.assign(process.env, env);
  delete require.cache[require.resolve(ecosystemPath)];
  return (require(ecosystemPath) as { apps: App[] }).apps;
}

function scratch(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alo-pm2-"));
  temporary.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  for (const key of overrides) delete process.env[key];
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("panel.env parser (PM2 7 ignores env_file)", () => {
  it("reads plain, exported and quoted assignments", () => {
    expect(
      parsePanelEnv(
        [
          "# comment",
          "",
          "PLAIN=value",
          "export EXPORTED=yes",
          'DOUBLE="two words"',
          "SINGLE='single quoted'",
          "  SPACED  =  padded  ",
          "EMPTY=",
        ].join("\n"),
      ),
    ).toEqual({
      PLAIN: "value",
      EXPORTED: "yes",
      DOUBLE: "two words",
      SINGLE: "single quoted",
      SPACED: "padded",
      EMPTY: "",
    });
  });

  it("keeps = and # that belong to the value", () => {
    const env = parsePanelEnv(
      [
        "DATABASE_URL=file:/var/lib/alo-hosting/production.db",
        "TOKEN=abc=def==",
        "URL=https://example.com/page#section",
        'QUOTED_HASH="pass # word"',
        "TRAILING=value   # explanation",
      ].join("\n"),
    );
    expect(env.DATABASE_URL).toBe("file:/var/lib/alo-hosting/production.db");
    expect(env.TOKEN).toBe("abc=def==");
    expect(env.URL).toBe("https://example.com/page#section");
    expect(env.QUOTED_HASH).toBe("pass # word");
    expect(env.TRAILING).toBe("value");
  });

  it("handles CRLF files, ignores malformed lines, and lets the last assignment win", () => {
    expect(parsePanelEnv("A=1\r\nnot an assignment\r\n1BAD=x\r\nA=2\r\n")).toEqual({ A: "2" });
  });

  it("returns an empty object for a missing file", () => {
    expect(readPanelEnv(path.join(os.tmpdir(), "alo-pm2-does-not-exist.env"))).toEqual({});
  });
});

describe("PM2 ecosystem profile", () => {
  it("forces the nginx port and loopback bind over values in panel.env", () => {
    const dir = scratch({ "panel.env": "PORT=3051\nHOSTNAME=0.0.0.0\nNEXTAUTH_SECRET=from-panel-env\n" });
    const [panel] = loadEcosystem({ PANEL_ENV_FILE: path.join(dir, "panel.env"), PANEL_APP_DIR: dir });
    expect(panel.name).toBe("alo-hosting-panel");
    expect(panel.exec_mode).toBe("fork");
    expect(panel.env.PORT).toBe("3000");
    expect(panel.env.HOSTNAME).toBe("127.0.0.1");
    expect(panel.env.NODE_ENV).toBe("production");
    expect(panel.env.NEXTAUTH_SECRET).toBe("from-panel-env");
    expect(panel.script).toBe(path.join(dir, ".next/standalone/server.js"));
  });

  it("honours PANEL_PORT", () => {
    const dir = scratch({ "panel.env": "A=1\n" });
    const [panel] = loadEcosystem({ PANEL_ENV_FILE: path.join(dir, "panel.env"), PANEL_APP_DIR: dir, PANEL_PORT: "3070" });
    expect(panel.env.PORT).toBe("3070");
  });

  it("runs only the panel, with panel.env's worker setting, when no worker bundle was built", () => {
    const dir = scratch({ "panel.env": "DEPLOY_INLINE_WORKER=true\n" });
    const apps = loadEcosystem({ PANEL_ENV_FILE: path.join(dir, "panel.env"), PANEL_APP_DIR: dir });
    expect(apps.map((app) => app.name)).toEqual(["alo-hosting-panel"]);
    expect(apps[0].env.DEPLOY_INLINE_WORKER).toBe("true");
  });

  it("adds the durable workers and turns the in-process worker off when their bundles exist", () => {
    const dir = scratch({
      "panel.env": "DEPLOY_INLINE_WORKER=true\nJWT_SECRET=shared\n",
      ".next/standalone/deploy-worker.cjs": "",
      ".next/standalone/automation-worker.cjs": "",
    });
    const apps = loadEcosystem({ PANEL_ENV_FILE: path.join(dir, "panel.env"), PANEL_APP_DIR: dir });
    expect(apps.map((app) => app.name)).toEqual(["alo-hosting-panel", "alo-deploy-worker", "alo-automation-worker"]);
    for (const app of apps) {
      expect(app.env.DEPLOY_INLINE_WORKER).toBe("false");
      expect(app.env.JWT_SECRET).toBe("shared");
    }
  });
});

describe("PM2 profile files stay consistent", () => {
  const nginx = fs.readFileSync(path.join(repo, "deploy/nginx/hosting.alolabs.net.pm2-origin-cert.conf"), "utf8");
  const directives = nginx
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
  const script = fs.readFileSync(path.join(repo, "scripts/deploy-pm2.sh"), "utf8");

  it("nginx proxies both ports to the PM2 port and never redirects or aliases", () => {
    expect(directives.filter((line) => line === "proxy_pass http://127.0.0.1:3000;")).toHaveLength(2);
    expect(directives.some((line) => line.startsWith("return 301"))).toBe(false);
    expect(directives.some((line) => line.startsWith("alias ") || line.startsWith("root "))).toBe(false);
    expect(directives).toContain("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
    // nginx 1.18 on the host does not know the standalone `http2 on;` directive.
    expect(directives).not.toContain("http2 on;");
  });

  it("the deploy script backs up before the schema step and restarts only after the build", () => {
    const commands = script
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    const at = (needle: string) => {
      const index = commands.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    };
    const backup = at("node scripts/db-backup.mjs");
    const schema = at("npx prisma db push --skip-generate");
    const build = at("with_panel_env npm run build\n");
    const copy = at('cp -R "$ROOT/.next/static"');
    const restart = at("pm2 startOrReload");
    expect(backup).toBeLessThan(schema);
    expect(schema).toBeLessThan(build);
    expect(build).toBeLessThan(copy);
    expect(copy).toBeLessThan(restart);
    expect(commands).not.toContain("--accept-data-loss");
    expect(script).toMatch(/id -u\)" -ne 0/);
    // The env file is parsed as data; it must never be sourced by the shell.
    expect(script).not.toMatch(/^\s*(source|\.)\s+"?\$ENV_FILE/m);
  });
});
