/**
 * SEC-11 — host-level deployment settings are operator-only.
 *
 * These tests exist because the defect was real: a tenant with WEBSITE_UPDATE
 * could PATCH a deploy project with `serviceName: "alo-hosting-panel"`, and the
 * next deploy would run `systemctl restart alo-hosting-panel` on the platform
 * itself. The PATCH route had no port check at all, so a tenant could also claim
 * a port the control plane listens on and shadow it behind the proxy.
 *
 * Policy (src/lib/deploy/host-settings.ts):
 *   - reserved values are refused for everyone, including operators
 *   - changing port / serviceName / serviceManager requires an operator role
 *   - keeping an existing value is allowed for tenants, so a project an
 *     operator configured does not break the next time the tenant edits it
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertBaselineDeploySettings,
  assertDeploySettingsChangeAllowed,
  assertReservedServiceName,
  isDeploySettingsOperator,
  isReservedPlatformPort,
  isReservedServiceName,
  stripHostLevelChanges,
  HostLevelSettingError,
  RESERVED_PLATFORM_PORTS,
  RESERVED_SERVICE_NAMES,
  DEPLOY_SETTINGS_OPERATOR_ROLES,
} from "@/lib/deploy/host-settings";
import { validateDeployConfig } from "@/lib/deploy/config";

const TENANT_ROLE = "CLIENT";

describe("SEC-11: reserved platform service names", () => {
  it("refuses the control-plane and worker unit names", () => {
    for (const name of [
      "alo-hosting-panel",
      "alo-automation-worker",
      "alo-server-hosting",
      "alo-port-8080-validator",
      "alo-hosting",
    ]) {
      expect(isReservedServiceName(name)).toBe(true);
      expect(() => assertReservedServiceName(name)).toThrow(HostLevelSettingError);
    }
  });

  it("matches case-insensitively and tolerates surrounding whitespace, because systemd does", () => {
    // A tenant writing "ALO-HOSTING-PANEL" must not slip past a case-sensitive
    // comparison and then be normalised by the service manager.
    expect(isReservedServiceName("  ALO-Hosting-Panel  ")).toBe(true);
    expect(isReservedServiceName("Alo-Automation-Worker")).toBe(true);
  });

  it("allows a normal tenant service name", () => {
    expect(isReservedServiceName("alo-site-blog.example.com")).toBe(false);
    expect(() => assertReservedServiceName("alo-site-blog.example.com")).not.toThrow();
    expect(isReservedServiceName(null)).toBe(false);
    expect(isReservedServiceName(undefined)).toBe(false);
    expect(isReservedServiceName("")).toBe(false);
  });

  it("is enforced by validateDeployConfig, so every route inherits it", () => {
    // This is the important one: the shared validator is the choke point. If a
    // future route calls validateDeployConfig and nothing else, the check still
    // runs.
    expect(() =>
      validateDeployConfig({
        version: 1,
        serviceManager: "systemd",
        serviceName: "alo-hosting-panel",
      }),
    ).toThrow(/belongs to the hosting platform/);
  });

  it("keeps the reserved list aligned with the shipped units", () => {
    // Guards against adding a unit to deploy/systemd without reserving its name.
    const unitFiles = fs
      .readdirSync(path.resolve("deploy/systemd"))
      .filter((f) => f.endsWith(".service"))
      .map((f) => f.replace(/\.service$/, ""));
    for (const unit of unitFiles) {
      expect(RESERVED_SERVICE_NAMES).toContain(unit);
    }
  });
});

describe("SEC-11: reserved platform ports", () => {
  it("refuses the panel's ports, including the stale 3051 and the Docker 8080", () => {
    for (const port of [3051, 3000, 8080]) {
      expect(isReservedPlatformPort(port)).toBe(true);
      expect(() => assertBaselineDeploySettings({ port })).toThrow(HostLevelSettingError);
    }
    expect(RESERVED_PLATFORM_PORTS).toContain(3051);
    expect(RESERVED_PLATFORM_PORTS).toContain(8080);
  });

  it("refuses privileged ports below 1024", () => {
    for (const port of [80, 443, 22, 1023]) {
      expect(() => assertBaselineDeploySettings({ port })).toThrow(/between 1024 and 65535/);
    }
  });

  it("refuses non-integers and out-of-range values", () => {
    expect(() => assertBaselineDeploySettings({ port: 3062.5 })).toThrow(HostLevelSettingError);
    expect(() => assertBaselineDeploySettings({ port: 70000 })).toThrow(HostLevelSettingError);
  });

  it("allows a normal application port", () => {
    expect(() => assertBaselineDeploySettings({ port: 3062 })).not.toThrow();
    expect(isReservedPlatformPort(3062)).toBe(false);
  });

  it("does not reject a port an application declares in its own manifest", () => {
    // Detection reads a framework's default port (Next.js says 3000, many Node
    // apps say 8080). That is a property of the customer's app, not a claim on a
    // host port, so validateDeployConfig must not refuse it. Enforcing ports
    // inside the shared validator broke this and was reverted -- see the comment
    // on assertReservedServiceName.
    expect(() => validateDeployConfig({ version: 1, port: 8080 })).not.toThrow();
    expect(() => validateDeployConfig({ version: 1, port: 3000 })).not.toThrow();
  });
});

describe("SEC-11: operator requirement for host-level changes", () => {
  it("treats only deploy administrator roles as operators", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "DEVOPS"]) {
      expect(isDeploySettingsOperator(role)).toBe(true);
    }
    // SUPPORT and RESELLER can manage websites but must not touch host settings.
    for (const role of ["CLIENT", "SUPPORT", "RESELLER", "VIEWER", "", null, undefined]) {
      expect(isDeploySettingsOperator(role as string | null | undefined)).toBe(false);
    }
    expect(DEPLOY_SETTINGS_OPERATOR_ROLES).not.toContain("SUPPORT");
  });

  it("refuses a tenant changing the port", () => {
    expect(() =>
      assertDeploySettingsChangeAllowed({ port: 3063 }, { port: 3062 }, TENANT_ROLE),
    ).toThrow(/requires an operator/);
  });

  it("refuses a tenant changing the service name", () => {
    expect(() =>
      assertDeploySettingsChangeAllowed(
        { serviceName: "alo-site-evil" },
        { serviceName: "alo-site-good" },
        TENANT_ROLE,
      ),
    ).toThrow(/requires an operator/);
  });

  it("refuses a tenant switching to a privileged service manager", () => {
    // static -> systemd is the escalation that makes serviceName reach systemctl.
    expect(() =>
      assertDeploySettingsChangeAllowed(
        { serviceManager: "systemd" },
        { serviceManager: "static" },
        TENANT_ROLE,
      ),
    ).toThrow(/requires an operator/);
  });

  it("allows a tenant to keep the values an operator already set", () => {
    // Editing a build command must not require re-confirming the port.
    const current = { port: 3062, serviceName: "alo-site-blog.example.com", serviceManager: "systemd" };
    expect(() =>
      assertDeploySettingsChangeAllowed({ ...current }, current, TENANT_ROLE),
    ).not.toThrow();
  });

  it("allows an operator to change host-level settings", () => {
    expect(() =>
      assertDeploySettingsChangeAllowed({ port: 3063 }, { port: 3062 }, "ADMIN"),
    ).not.toThrow();
    expect(() =>
      assertDeploySettingsChangeAllowed(
        { serviceName: "alo-site-new.example.com" },
        { serviceName: "alo-site-old.example.com" },
        "DEVOPS",
      ),
    ).not.toThrow();
  });

  it("still refuses a reserved value to an operator", () => {
    // Being an operator is not a licence to point a tenant deploy at the panel.
    expect(() =>
      assertDeploySettingsChangeAllowed(
        { serviceName: "alo-hosting-panel" },
        { serviceName: "alo-site-blog.example.com" },
        "SUPER_ADMIN",
      ),
    ).toThrow(/belongs to the hosting platform/);
    expect(() =>
      assertDeploySettingsChangeAllowed({ port: 3051 }, { port: 3062 }, "SUPER_ADMIN"),
    ).toThrow(/reserved for the hosting platform/);
  });

  it("reports which field was refused, so the UI can point at it", () => {
    try {
      assertDeploySettingsChangeAllowed({ port: 3063 }, { port: 3062 }, TENANT_ROLE);
      throw new Error("expected a HostLevelSettingError");
    } catch (e) {
      expect(e).toBeInstanceOf(HostLevelSettingError);
      expect((e as HostLevelSettingError).field).toBe("port");
      expect((e as HostLevelSettingError).code).toBe("OPERATOR_ONLY_SETTING");
    }
  });

  it("allows a first write by a tenant when the current config has no host values", () => {
    // Creating a project must not require an operator unless it asks for a
    // non-default host value.
    expect(() => assertDeploySettingsChangeAllowed({ port: null }, null, TENANT_ROLE)).not.toThrow();
  });
});

describe("SEC-11: stripHostLevelChanges", () => {
  it("preserves the stored value when a tenant tries to change it", () => {
    const patch = { buildCmd: "npm run build", port: 3051 };
    const out = stripHostLevelChanges(patch, { port: 3062 }, TENANT_ROLE);
    expect(out.port).toBe(3062);
    expect(out.buildCmd).toBe("npm run build");
  });

  it("drops the field when there is no stored value to preserve", () => {
    const out = stripHostLevelChanges({ port: 3051, buildCmd: "npm run build" }, null, TENANT_ROLE);
    expect("port" in out).toBe(false);
    expect(out.buildCmd).toBe("npm run build");
  });

  it("leaves an operator's patch untouched", () => {
    const patch = { port: 3063, serviceName: "alo-site-x" };
    expect(stripHostLevelChanges(patch, { port: 3062 }, "ADMIN")).toEqual(patch);
  });

  it("leaves an unchanged tenant value alone", () => {
    const patch = { port: 3062, buildCmd: "npm run build" };
    const out = stripHostLevelChanges(patch, { port: 3062 }, TENANT_ROLE);
    expect(out.port).toBe(3062);
  });
});

describe("SEC-11: the execution barrier itself", () => {
  it("restartExternalService refuses a platform unit even when called directly", async () => {
    // Defence in depth. The route-level check is the first barrier; this is the
    // last one, at the function that actually spawns systemctl. If a future
    // route forgets its role check, this still holds.
    const { restartExternalService } = await import("@/lib/deploy/service");
    for (const name of ["alo-hosting-panel", "alo-automation-worker", "alo-hosting"]) {
      await expect(restartExternalService("systemd", name)).rejects.toThrow(
        /belongs to the hosting platform/,
      );
      await expect(restartExternalService("pm2", name)).rejects.toThrow(
        /belongs to the hosting platform/,
      );
    }
  });

  it("still validates the service name shape before the reserved-name check", async () => {
    const { restartExternalService } = await import("@/lib/deploy/service");
    await expect(restartExternalService("systemd", "bad;rm -rf /")).rejects.toThrow(
      /Unsafe service name/,
    );
  });

  it("is a no-op for a static deployment, which never touches a service manager", async () => {
    const { restartExternalService } = await import("@/lib/deploy/service");
    await expect(restartExternalService("static", "alo-hosting-panel")).resolves.toBeUndefined();
  });
});

describe("SEC-11: every tenant-reachable write enforces the policy", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("the dashboard PATCH route checks the role before merging host settings", () => {
    const code = read("src/app/api/deploy/projects/[id]/route.ts");
    expect(code).toContain("assertDeploySettingsChangeAllowed");
    expect(code).toContain("OPERATOR_ONLY_SETTING");
    // The check must come before the merge that persists the value.
    expect(code.indexOf("assertDeploySettingsChangeAllowed")).toBeLessThan(
      code.indexOf("const merged = validateDeployConfig"),
    );
  });

  it("both AI provisioning routes apply the reserved-port set", () => {
    for (const route of [
      "src/app/api/ai/auto-deploy/route.ts",
      "src/app/api/ai/operator/route.ts",
    ]) {
      const code = read(route);
      expect(code, route).toContain("assertBaselineDeploySettings");
      expect(code, route).toContain("@/lib/deploy/host-settings");
    }
  });

  it("validateDeployConfig is the shared choke point for reserved names", () => {
    const code = read("src/lib/deploy/config.ts");
    expect(code).toContain("assertReservedServiceName");
  });

  it("restartExternalService guards the process it spawns", () => {
    const code = read("src/lib/deploy/service.ts");
    expect(code).toContain("assertReservedServiceName");
  });
});
