/**
 * Phase 2 (server agents) — §5 host reporting capabilities.
 *
 * Covers the five new read-only commands — system.inventory, mount.list,
 * service.list, container.status, log.tail — on both sides of the trust
 * boundary:
 *   - panel ↔ agent allowlist parity (the compiled-in copy cannot drift),
 *   - agent-side execution against this Linux host (real /proc values),
 *   - log.tail's path jail (never a general file-read primitive),
 *   - control-plane authorizeCommand grants/refusals,
 *   - heartbeat inventory mirroring onto the Server row (real values only).
 *
 * Database-touching tests import their modules after isolated-db has pointed
 * DATABASE_URL at this file's own copy of db/custom.db.
 */
import "./helpers/isolated-db";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import {
  AGENT_ALLOWLIST,
  ALLOWED_AGENT_COMMANDS,
  DEFAULT_AGENT_CAPABILITIES,
  authorizeCommand,
  allowlistCatalogue,
  findAllowlistEntry,
} from "@/lib/agents/allowlist";
import * as host from "../agent/alo-agent.mjs";
import { db } from "@/lib/db";
import { recordHeartbeat } from "@/lib/agents/agent";
import { encryptSecret } from "@/lib/encryption";
import { teardownIsolatedDb } from "./helpers/isolated-db";

const NEW_COMMANDS = [
  "system.inventory",
  "mount.list",
  "service.list",
  "container.status",
  "log.tail",
] as const;

afterAll(async () => {
  await teardownIsolatedDb();
});

describe("allowlist parity for the new inventory commands", () => {
  it("panel and agent declare the identical command set", () => {
    expect(Object.keys(host.AGENT_ALLOWLIST).sort()).toEqual([...ALLOWED_AGENT_COMMANDS].sort());
    for (const command of NEW_COMMANDS) {
      expect(ALLOWED_AGENT_COMMANDS.has(command)).toBe(true);
      expect(host.AGENT_ALLOWLIST[command]).toBeDefined();
    }
  });

  it("risk levels agree between both copies", () => {
    for (const entry of AGENT_ALLOWLIST) {
      expect(host.AGENT_ALLOWLIST[entry.command]?.risk, `${entry.command} risk mismatch`).toBe(entry.risk);
    }
  });

  it("every new command is READ_ONLY and granted to newly enrolled agents", () => {
    for (const command of NEW_COMMANDS) {
      const entry = findAllowlistEntry(command);
      expect(entry, command).toBeDefined();
      expect(entry!.risk).toBe("READ_ONLY");
      expect(DEFAULT_AGENT_CAPABILITIES).toContain(command);
    }
  });

  it("the dashboard catalogue describes them", () => {
    const catalogue = allowlistCatalogue();
    for (const command of NEW_COMMANDS) {
      const item = catalogue.find((c) => c.command === command);
      expect(item, command).toBeDefined();
      expect(item!.label.length).toBeGreaterThan(0);
      expect(item!.description.length).toBeGreaterThan(0);
    }
  });
});

describe("agent-side execution on this host", () => {
  it("system.inventory reports real OS values, not placeholders", async () => {
    const res = await host.executeTask({ command: "system.inventory", args: "{}" });
    expect(res.status).toBe("SUCCEEDED");
    expect(res.result.hostname).toBe(os.hostname());
    expect(res.result.platform).toBe(process.platform);
    expect(res.result.kernel).toBe(os.release());
    expect(res.result.cpuCores).toBeGreaterThanOrEqual(1);
    expect(res.result.ramGb).toBeGreaterThan(0);
    expect(res.result.uptimeSeconds).toBeGreaterThan(0);
  });

  it("mount.list reads /proc/mounts and includes the root mount", async () => {
    const res = await host.executeTask({ command: "mount.list", args: "{}" });
    expect(res.status).toBe("SUCCEEDED");
    expect(Array.isArray(res.result.mounts)).toBe(true);
    expect(res.result.count).toBeLessThanOrEqual(200);
    expect(
      res.result.mounts.some((m: { mountpoint: string }) => m.mountpoint === "/")
    ).toBe(true);
    for (const m of res.result.mounts) {
      expect(typeof m.device).toBe("string");
      expect(typeof m.fstype).toBe("string");
    }
  });

  it("service.list and container.status carry fixed argv and accept no arguments", () => {
    expect(host.AGENT_ALLOWLIST["service.list"].argv({})).toEqual([
      "list-units",
      "--type=service",
      "--no-legend",
      "--plain",
      "--no-pager",
    ]);
    expect(host.AGENT_ALLOWLIST["container.status"].argv({})).toEqual(["ps", "-a"]);
    expect(host.AGENT_ALLOWLIST["service.list"].validate({})).toBe(true);
    expect(host.AGENT_ALLOWLIST["container.status"].validate({})).toBe(true);
    // The panel builds the identical argv for dispatch.
    const panelService = findAllowlistEntry("service.list")!;
    expect(panelService.argv({})).toEqual(host.AGENT_ALLOWLIST["service.list"].argv({}));
    const panelDocker = findAllowlistEntry("container.status")!;
    expect(panelDocker.argv({})).toEqual(host.AGENT_ALLOWLIST["container.status"].argv({}));
  });

  it("log.tail only accepts .log paths inside the two allowed directories", () => {
    const entry = host.AGENT_ALLOWLIST["log.tail"];
    expect(entry.validate({ path: "/var/log/alo/app.log" })).toBe(true);
    expect(entry.validate({ path: "/opt/alo/logs/deploy.log", lines: 50 })).toBe(true);
    // Everything outside the jail is refused — including traversal attempts.
    expect(entry.validate({ path: "/etc/shadow" })).toBe(false);
    expect(entry.validate({ path: "/etc/passwd" })).toBe(false);
    expect(entry.validate({ path: "/var/log/../etc/shadow.log" })).toBe(false);
    expect(entry.validate({ path: "/home/user/secrets.log" })).toBe(false);
    expect(entry.validate({ path: "/var/log/alo/app.log", lines: 5000 })).toBe(false);
    expect(entry.validate({ path: "/var/log/alo/app.log", lines: 0 })).toBe(false);
    // Argv shape matches the panel's, with the same 200-line default.
    expect(entry.argv({ path: "/var/log/alo/app.log", lines: 50 })).toEqual([
      "-n",
      "50",
      "/var/log/alo/app.log",
    ]);
    expect(entry.argv({ path: "/var/log/alo/app.log" })).toEqual([
      "-n",
      "200",
      "/var/log/alo/app.log",
    ]);
    const panel = findAllowlistEntry("log.tail")!;
    expect(panel.argv({ path: "/var/log/alo/app.log", lines: 50 })).toEqual(
      entry.argv({ path: "/var/log/alo/app.log", lines: 50 })
    );
  });

  it("refuses a log.tail path outside the jail before spawning anything", async () => {
    const res = await host.executeTask({
      command: "log.tail",
      args: JSON.stringify({ path: "/etc/passwd" }),
    });
    expect(res.status).toBe("REFUSED");
    expect(res.refuseReason).toContain("schema check");
    const traversal = await host.executeTask({
      command: "log.tail",
      args: JSON.stringify({ path: "/var/log/../../etc/shadow.log" }),
    });
    expect(traversal.status).toBe("REFUSED");
  });

  it("still refuses commands that are not in the compiled-in allowlist", async () => {
    const res = await host.executeTask({ command: "shell.exec", args: JSON.stringify({ cmd: "id" }) });
    expect(res.status).toBe("REFUSED");
  });
});

describe("control-plane authorization for the new commands", () => {
  it("allows system.inventory with the granted capability and server:read scope", () => {
    const decision = authorizeCommand({
      command: "system.inventory",
      args: {},
      agentCapabilities: [...DEFAULT_AGENT_CAPABILITIES],
      actorScopes: ["server:read"],
    });
    expect(decision.allowed).toBe(true);
  });

  it("refuses when the agent was never granted the capability", () => {
    const decision = authorizeCommand({
      command: "system.inventory",
      args: {},
      agentCapabilities: ["metrics.collect"],
      actorScopes: ["server:read"],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("not been granted");
  });

  it("refuses a log.tail path outside the jail with an explainable reason", () => {
    const decision = authorizeCommand({
      command: "log.tail",
      args: { path: "/etc/shadow" },
      agentCapabilities: [...DEFAULT_AGENT_CAPABILITIES],
      actorScopes: ["monitoring:read"],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("failed validation");
  });

  it("requires monitoring:read for log.tail even with the capability granted", () => {
    const decision = authorizeCommand({
      command: "log.tail",
      args: { path: "/var/log/alo/app.log" },
      agentCapabilities: [...DEFAULT_AGENT_CAPABILITIES],
      actorScopes: ["server:read"],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("monitoring:read");
  });
});

describe("heartbeat inventory mirroring", () => {
  let serverId = "";
  let agentId = "";

  beforeAll(async () => {
    const server = await db.server.create({
      data: { hostname: `inv-host-${Date.now()}`, name: "inventory-host" },
    });
    const agent = await db.serverAgent.create({
      data: {
        name: "inventory-agent",
        agentKey: `alo_agt_inv_${Date.now()}`,
        secretEnc: encryptSecret("alo_ags_inventory_secret"),
        status: "active",
        serverId: server.id,
      },
    });
    serverId = server.id;
    agentId = agent.id;
  });

  it("mirrors reported inventory onto the Server row", async () => {
    await recordHeartbeat(
      agentId,
      {
        metrics: { diskTotalGb: 100.4 },
        inventory: { platform: "linux", arch: "x64", kernel: "6.8.0-test", cpuCores: 4, ramGb: 8 },
      },
      "10.0.0.9"
    );
    const server = await db.server.findUnique({ where: { id: serverId } });
    expect(server).not.toBeNull();
    expect(server!.status).toBe("ONLINE");
    expect(server!.os).toBe("linux x64 6.8.0-test");
    expect(server!.cpuCores).toBe(4);
    expect(server!.ramGb).toBe(8);
    expect(server!.diskGb).toBe(100);
    expect(server!.lastSeenIp).toBeUndefined(); // Server has no such column — guard against invented fields
  });

  it("leaves inventory columns untouched when the agent reports nothing", async () => {
    await recordHeartbeat(agentId, {});
    const server = await db.server.findUnique({ where: { id: serverId } });
    expect(server!.os).toBe("linux x64 6.8.0-test");
    expect(server!.cpuCores).toBe(4);
    expect(server!.ramGb).toBe(8);
  });

  it("records a metric row per heartbeat without inventing zeros for missing values", async () => {
    const before = await db.agentMetric.count({ where: { agentId } });
    await recordHeartbeat(agentId, { metrics: { cpuPercent: 12.5 } });
    expect(await db.agentMetric.count({ where: { agentId } })).toBe(before + 1);
    // Query by content, not by uuid order — uuids are not monotonic.
    const row = await db.agentMetric.findFirst({ where: { agentId, cpuPercent: 12.5 } });
    expect(row).not.toBeNull();
    expect(row!.memoryUsedMb).toBeNull();
    expect(row!.diskUsedGb).toBeNull();
  });
});
