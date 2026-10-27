#!/usr/bin/env node
/**
 * ALO Hosting — secure server agent.
 *
 * Runs on each managed Linux host (Hostinger Cloud, Office Server A, Office
 * Server B) and talks to the panel over HTTPS. It has **no npm dependencies**
 * so it can be dropped on a host with nothing but Node.js >= 18 installed.
 *
 * What it does:
 *   1. enrolls once with a short-lived token, then keeps its credentials in a
 *      0600 file;
 *   2. sends a signed heartbeat with real metrics read from /proc and df;
 *   3. polls for tasks, executes only allowlisted commands, and posts
 *      structured results with sanitized logs.
 *
 * What it refuses to do:
 *   - run anything that is not in its own compiled-in copy of the allowlist
 *     (so a compromised control plane still cannot get a shell);
 *   - run a shell string — everything is execFile with an argv array;
 *   - put a secret in argv, an environment variable of a child, or a log line;
 *   - probe a public address (loopback/private only) so it cannot be used as an
 *     SSRF pivot.
 *
 * Usage:
 *   ALO_PANEL_URL=https://panel.example.com ALO_ENROLL_TOKEN=alo_enroll_xxx \
 *     node agent/alo-agent.mjs --name "office-a" --enroll
 *   node agent/alo-agent.mjs --once        # single heartbeat + task sweep
 *   node agent/alo-agent.mjs               # run forever
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const AGENT_VERSION = "1.0.0";

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_PANEL = process.env.ALO_PANEL_URL || "";
const DEFAULT_STATE = process.env.ALO_AGENT_STATE || path.join(os.homedir(), ".alo-agent", "agent.json");

export function readConfig(argv = process.argv.slice(2)) {
  const cfg = {
    panelUrl: DEFAULT_PANEL.replace(/\/+$/, ""),
    statePath: DEFAULT_STATE,
    name: os.hostname(),
    enrollToken: process.env.ALO_ENROLL_TOKEN || "",
    once: argv.includes("--once"),
    enroll: argv.includes("--enroll"),
    heartbeatMs: Number(process.env.ALO_HEARTBEAT_MS || 60_000),
    pollMs: Number(process.env.ALO_POLL_MS || 5_000),
    services: (process.env.ALO_WATCH_SERVICES || "").split(",").map((s) => s.trim()).filter(Boolean),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name" && argv[i + 1]) cfg.name = argv[i + 1];
    if (argv[i] === "--panel" && argv[i + 1]) cfg.panelUrl = argv[i + 1].replace(/\/+$/, "");
    if (argv[i] === "--state" && argv[i + 1]) cfg.statePath = argv[i + 1];
    if (argv[i] === "--token" && argv[i + 1]) cfg.enrollToken = argv[i + 1];
  }
  return cfg;
}

// ─── Compiled-in allowlist (agent-side copy) ────────────────────────────────
// The panel has its own copy in src/lib/agents/allowlist.ts. Both must agree;
// the agent's copy is the one that actually gates execution on the host.

const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9@:_.\-]{0,120}$/;
const ABS_PATH = /^\/[A-Za-z0-9_./\-]{1,300}$/;

export const AGENT_ALLOWLIST = {
  "metrics.collect": {
    executable: null, // handled internally, no child process
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    validate: () => true,
  },
  "service.status": {
    executable: "systemctl",
    argv: (a) => ["is-active", String(a.unit)],
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    validate: (a) => typeof a.unit === "string" && SERVICE_NAME.test(a.unit),
  },
  "service.restart": {
    executable: "systemctl",
    argv: (a) => ["restart", String(a.unit)],
    sudo: true,
    risk: "PRIVILEGED",
    timeoutMs: 60_000,
    validate: (a) => typeof a.unit === "string" && SERVICE_NAME.test(a.unit),
  },
  "process.list": {
    executable: "pm2",
    argv: () => ["jlist"],
    risk: "READ_ONLY",
    timeoutMs: 20_000,
    validate: () => true,
  },
  "health.probe": {
    executable: null, // handled internally with fetch()
    risk: "READ_ONLY",
    timeoutMs: 20_000,
    validate: (a) => typeof a.url === "string" && isPrivateTarget(a.url),
  },
  "disk.usage": {
    executable: "df",
    argv: (a) => ["-P", ...(a.path ? [String(a.path)] : [])],
    risk: "READ_ONLY",
    timeoutMs: 15_000,
    validate: (a) => a.path === undefined || a.path === null || (typeof a.path === "string" && ABS_PATH.test(a.path)),
  },
  "backup.database": {
    executable: "alo-site-backup",
    argv: (a) => ["--target", String(a.target || "/opt/backups")],
    sudo: true,
    risk: "REVERSIBLE",
    timeoutMs: 20 * 60_000,
    validate: (a) => a.target === undefined || a.target === null || (typeof a.target === "string" && ABS_PATH.test(a.target)),
  },
  "backup.verify": {
    executable: "sha256sum",
    argv: (a) => [String(a.path)],
    risk: "READ_ONLY",
    timeoutMs: 10 * 60_000,
    validate: (a) => typeof a.path === "string" && ABS_PATH.test(a.path),
  },
  "db.replication-status": {
    executable: null, // handled internally
    risk: "READ_ONLY",
    timeoutMs: 30_000,
    validate: () => true,
  },
};

/** Loopback / RFC1918 / link-local only. Refuses anything publicly routable. */
export function isPrivateTarget(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // hostnames are refused: they could resolve anywhere
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / Tailscale range
  return false;
}

// ─── Secret handling ────────────────────────────────────────────────────────

export async function loadState(statePath) {
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

export async function saveState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(statePath, 0o600).catch(() => {});
}

/** Strip anything that looks like a credential before it leaves the host. */
export function sanitize(text, extraSecrets = []) {
  if (!text) return "";
  let out = String(text);
  for (const secret of extraSecrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[REDACTED]");
  }
  out = out
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, "$1[REDACTED]$2")
    .replace(/\b(?:mysql|mariadb|postgres(?:ql)?):\/\/[^/\s:@]+:[^/\s@]+@/gi, "[REDACTED_DB_URL]")
    .replace(/((?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*)(["']?)[^\s"',;}{]{6,}\2/gi, "$1[REDACTED]");
  return out.slice(0, 50_000);
}

// ─── Signing ────────────────────────────────────────────────────────────────

export function sign(secret, body, timestamp, nonce) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${createHash("sha256").update(body).digest("hex")}`)
    .digest("hex");
}

export function verify(secret, body, timestamp, nonce, signature) {
  const expected = sign(secret, body, timestamp, nonce);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature || ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function post(panelUrl, route, bodyObject, credentials) {
  const body = JSON.stringify(bodyObject ?? {});
  const timestamp = String(Date.now());
  const nonce = randomBytes(12).toString("hex");
  const headers = { "content-type": "application/json", "x-alo-timestamp": timestamp, "x-alo-nonce": nonce };
  if (credentials?.agentKey && credentials?.secret) {
    headers["x-alo-agent-key"] = credentials.agentKey;
    headers["x-alo-signature"] = sign(credentials.secret, body, timestamp, nonce);
  }
  const res = await fetch(`${panelUrl}${route}`, { method: "POST", headers, body });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, json };
}

// ─── Real metrics ───────────────────────────────────────────────────────────

async function readProc(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

let previousCpu = null;

export async function cpuPercent() {
  const stat = await readProc("/proc/stat");
  if (!stat) return null;
  const line = stat.split("\n")[0] || "";
  const nums = line.split(/\s+/).slice(1).map(Number).filter((n) => Number.isFinite(n));
  if (nums.length < 4) return null;
  const idle = nums[3] + (nums[4] || 0);
  const total = nums.reduce((a, b) => a + b, 0);
  const sample = { idle, total };
  const prev = previousCpu;
  previousCpu = sample;
  if (!prev) {
    // First sample has no delta; report the lifetime average instead of a fake 0.
    return total > 0 ? round(((total - idle) / total) * 100) : null;
  }
  const dTotal = sample.total - prev.total;
  const dIdle = sample.idle - prev.idle;
  if (dTotal <= 0) return null;
  return round(((dTotal - dIdle) / dTotal) * 100);
}

export async function collectMetrics(services = []) {
  const [meminfo, loadavg, uptime] = await Promise.all([readProc("/proc/meminfo"), readProc("/proc/loadavg"), readProc("/proc/uptime")]);

  let memoryUsedMb = null;
  let memoryTotalMb = null;
  if (meminfo) {
    const get = (key) => {
      const m = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
      return m ? Number(m[1]) / 1024 : null; // kB → MB
    };
    memoryTotalMb = get("MemTotal");
    const available = get("MemAvailable");
    if (memoryTotalMb !== null && available !== null) memoryUsedMb = round(memoryTotalMb - available);
  }

  const load = loadavg ? round(Number(loadavg.split(/\s+/)[0])) : null;
  const up = uptime ? round(Number(uptime.split(/\s+/)[0])) : null;

  // Disk: use statfs on "/" via df so no native module is needed.
  let diskUsedGb = null;
  let diskTotalGb = null;
  try {
    const { stdout } = await run("df", ["-PB1", "/"], 10_000);
    const parts = stdout.trim().split("\n")[1]?.split(/\s+/) ?? [];
    if (parts.length >= 4) {
      diskTotalGb = round(Number(parts[1]) / 1024 ** 3);
      diskUsedGb = round(Number(parts[2]) / 1024 ** 3);
    }
  } catch {
    /* leave null: "unavailable" is honest, 0 is not */
  }

  const cpu = await cpuPercent();

  const serviceStates = [];
  for (const unit of services.slice(0, 20)) {
    if (!SERVICE_NAME.test(unit)) continue;
    try {
      const { stdout, code } = await run("systemctl", ["is-active", unit], 10_000);
      serviceStates.push({ name: unit, state: (stdout || "").trim() || (code === 0 ? "active" : "inactive") });
    } catch {
      serviceStates.push({ name: unit, state: "unknown" });
    }
  }

  return {
    cpuPercent: cpu,
    memoryUsedMb,
    memoryTotalMb,
    diskUsedGb,
    diskTotalGb,
    loadAvg1m: load,
    uptimeSeconds: up,
    netInKbps: null, // requires two /proc/net/dev samples; reported as unavailable rather than guessed
    netOutKbps: null,
    services: serviceStates.length ? serviceStates : null,
  };
}

function round(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function run(executable, args, timeoutMs, useSudo = false) {
  return new Promise((resolve, reject) => {
    const cmd = useSudo ? "sudo" : executable;
    const argv = useSudo ? ["-n", executable, ...args] : args;
    const child = execFile(cmd, argv, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C" } }, (error, stdout, stderr) => {
      resolve({ code: error && typeof error.code === "number" ? error.code : error ? 1 : 0, stdout: stdout ?? "", stderr: stderr ?? "", error: error ? String(error.message).slice(0, 300) : null });
    });
    child.on("error", (e) => reject(e));
  });
}

// ─── Task execution ─────────────────────────────────────────────────────────

/**
 * Validate + execute one task. Returns a structured result; never throws for a
 * refused command, because the refusal itself is the answer.
 */
export async function executeTask(task, secrets = []) {
  const entry = AGENT_ALLOWLIST[task.command];
  if (!entry) {
    return { status: "REFUSED", refuseReason: `Command "${task.command}" is not in this agent's compiled-in allowlist`, exitCode: null };
  }

  let args = {};
  try {
    args = task.args ? (typeof task.args === "string" ? JSON.parse(task.args) : task.args) : {};
  } catch {
    return { status: "REFUSED", refuseReason: "Task arguments are not valid JSON", exitCode: null };
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { status: "REFUSED", refuseReason: "Task arguments must be a JSON object", exitCode: null };
  }
  if (!entry.validate(args)) {
    return { status: "REFUSED", refuseReason: `Arguments for "${task.command}" failed the agent-side schema check`, exitCode: null };
  }

  const started = Date.now();
  try {
    if (task.command === "metrics.collect") {
      const metrics = await collectMetrics();
      return { status: "SUCCEEDED", exitCode: 0, result: metrics, durationMs: Date.now() - started };
    }
    if (task.command === "health.probe") {
      const url = String(args.url);
      if (!isPrivateTarget(url)) {
        return { status: "REFUSED", refuseReason: `Refusing to probe ${url}: only loopback and private addresses are allowed`, exitCode: null };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), entry.timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal, redirect: "error" });
        const body = (await res.text()).slice(0, 2000);
        return {
          status: "SUCCEEDED",
          exitCode: 0,
          result: { url, httpStatus: res.status, latencyMs: Date.now() - started, commit: (body.match(/\b[0-9a-f]{40}\b/) || [null])[0] },
          durationMs: Date.now() - started,
        };
      } finally {
        clearTimeout(timer);
      }
    }
    if (task.command === "db.replication-status") {
      return {
        status: "REFUSED",
        refuseReason:
          "db.replication-status needs database credentials on this host. Configure /etc/alo-agent/db.cnf and re-run; the agent will not read credentials from the panel or from argv.",
        exitCode: null,
      };
    }

    const argv = entry.argv(args);
    for (const token of argv) {
      if (/[;&|`$<>(){}!*?~#\n\r]/.test(String(token))) {
        return { status: "REFUSED", refuseReason: "An argument contains a shell metacharacter", exitCode: null };
      }
    }
    const out = await run(entry.executable, argv, entry.timeoutMs, Boolean(entry.sudo));
    const succeeded = out.code === 0 || (task.command === "service.status" && out.code === 3);
    return {
      status: succeeded ? "SUCCEEDED" : "FAILED",
      exitCode: out.code,
      result: { command: task.command, argv: [entry.executable, ...argv], stdoutHead: (out.stdout || "").slice(0, 400) },
      logs: sanitize(`${out.stdout || ""}\n${out.stderr || ""}`.trim(), secrets),
      error: out.error ? sanitize(out.error, secrets) : succeeded ? undefined : sanitize((out.stderr || "").slice(0, 500), secrets) || `exit code ${out.code}`,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      status: "FAILED",
      exitCode: null,
      error: sanitize(error instanceof Error ? error.message : String(error), secrets),
      durationMs: Date.now() - started,
    };
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export async function enroll(cfg) {
  if (!cfg.panelUrl) throw new Error("ALO_PANEL_URL (or --panel) is required");
  if (!cfg.enrollToken) throw new Error("ALO_ENROLL_TOKEN (or --token) is required to enrol");
  const res = await post(cfg.panelUrl, "/api/agents/enroll", {
    token: cfg.enrollToken,
    name: cfg.name,
    version: AGENT_VERSION,
    hostname: os.hostname(),
  });
  if (!res.ok || !res.json?.success) {
    throw new Error(`Enrollment failed (HTTP ${res.status}): ${res.json?.message ?? res.json?.error?.message ?? "unknown"}`);
  }
  const data = res.json.data;
  const state = {
    panelUrl: cfg.panelUrl,
    agentId: data.agentId,
    agentKey: data.agentKey,
    secret: data.secret,
    capabilities: data.capabilities ?? [],
    heartbeatMs: data.heartbeatIntervalMs ?? cfg.heartbeatMs,
    pollMs: data.pollIntervalMs ?? cfg.pollMs,
    enrolledAt: new Date().toISOString(),
  };
  await saveState(cfg.statePath, state);
  return state;
}

export async function heartbeatOnce(cfg, state) {
  const metrics = await collectMetrics(cfg.services);
  const res = await post(
    cfg.panelUrl,
    "/api/agents/heartbeat",
    { version: AGENT_VERSION, metrics, capabilities: Object.keys(AGENT_ALLOWLIST) },
    { agentKey: state.agentKey, secret: state.secret },
  );
  return { status: res.status, ok: res.ok, message: res.json?.message };
}

export async function pollAndRunOnce(cfg, state) {
  const res = await post(cfg.panelUrl, "/api/agents/tasks/claim", {}, { agentKey: state.agentKey, secret: state.secret });
  if (!res.ok) return { ran: 0, error: `HTTP ${res.status}` };
  const task = res.json?.data?.task;
  if (!task) return { ran: 0 };

  const outcome = await executeTask(task, [state.secret]);
  await post(
    cfg.panelUrl,
    "/api/agents/tasks/result",
    { taskId: task.id, ...outcome },
    { agentKey: state.agentKey, secret: state.secret },
  );
  return { ran: 1, command: task.command, status: outcome.status };
}

export async function main() {
  const cfg = readConfig();
  let state = await loadState(cfg.statePath);

  if (cfg.enroll || !state) {
    state = await enroll(cfg);
    console.log(`enrolled as ${state.agentKey}; state written to ${cfg.statePath} (mode 0600)`);
  }
  if (!cfg.panelUrl) cfg.panelUrl = state.panelUrl;

  if (cfg.once) {
    const hb = await heartbeatOnce(cfg, state);
    const tasks = await pollAndRunOnce(cfg, state);
    console.log(JSON.stringify({ heartbeat: hb, tasks }));
    return;
  }

  console.log(`agent ${state.agentKey} starting; heartbeat ${cfg.heartbeatMs}ms, poll ${cfg.pollMs}ms`);
  const stop = () => {
    console.log("shutting down gracefully");
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  // Stagger the two loops so a slow task cannot delay the heartbeat.
  setInterval(() => heartbeatOnce(cfg, state).catch((e) => console.error("heartbeat failed:", e.message)), cfg.heartbeatMs);
  setInterval(() => pollAndRunOnce(cfg, state).catch((e) => console.error("task poll failed:", e.message)), cfg.pollMs);
  await heartbeatOnce(cfg, state).catch(() => {});
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("agent error:", sanitize(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
}
