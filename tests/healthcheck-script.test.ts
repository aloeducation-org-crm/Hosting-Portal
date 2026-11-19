import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("panel healthcheck port", () => {
  function run(env: Record<string, string>, args: string[] = []) {
    const dir = mkdtempSync(path.join(tmpdir(), "panel-healthcheck-"));
    dirs.push(dir);
    const log = path.join(dir, "url");
    writeFileSync(path.join(dir, "curl"), '#!/bin/bash\nprintf "%s" "${!#}" > "$HEALTH_TEST_LOG"\nprintf "%s" "${HEALTH_TEST_STATUS:-200}"\n', { mode: 0o755 });
    const result = spawnSync("bash", ["scripts/healthcheck.sh", ...args], {
      encoding: "utf8",
      env: { PATH: `${dir}:${process.env.PATH}`, HEALTH_TEST_LOG: log, ...env },
    });
    return { result, url: readFileSync(log, "utf8") };
  }

  it("defaults to the PM2/nginx panel health endpoint", () => {
    const { result, url } = run({});
    expect(result.status).toBe(0);
    expect(url).toBe("http://127.0.0.1:3062/api/health");
  });
  it("supports PORT and gives PANEL_PORT precedence like the PM2 profile", () => {
    expect(run({ PORT: "8080" }).url).toBe("http://127.0.0.1:8080/api/health");
    expect(run({ PORT: "3051", PANEL_PORT: "3070" }).url).toBe("http://127.0.0.1:3070/api/health");
  });
  it("honours an explicit URL and fails on an unhealthy response", () => {
    const { result, url } = run({ PANEL_PORT: "3070", HEALTH_TEST_STATUS: "503" }, ["http://127.0.0.1:9999/api/ready"]);
    expect(url).toBe("http://127.0.0.1:9999/api/ready");
    expect(result.status).toBe(1);
  });
});
