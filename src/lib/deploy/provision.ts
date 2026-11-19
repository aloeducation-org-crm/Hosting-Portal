import net from "node:net";
import { db } from "@/lib/db";
import { callHelper } from "@/lib/helpers";
import { logger } from "@/lib/logger";
import { ALO_SERVER_SPEC } from "./server-spec";
import { redact } from "./redact";

/**
 * Dynamic Nginx + PM2 + Certbot provisioning.
 *
 * This is the panel-side orchestration that makes a "publish from the
 * dashboard" flow a real hosting-provider action: allocate a free server
 * port, register and start a PM2 process, write a Nginx server block into
 * `/etc/nginx/sites-available/` + enable it + reload Nginx, and issue a
 * Let's Encrypt certificate with Certbot.
 *
 * It sits on top of the existing privileged host helpers
 * (`alo-app-helper`, `alo-nginx-helper`, `alo-certbot-helper`) which do the
 * actual root-level work. Every step is best-effort and environment-gated so
 * a host that has not installed a given helper degrades gracefully instead of
 * failing the whole launch.
 */

/** Per-step outcome of a launch/provision run. */
export interface ProvisionStep {
  step: "port" | "pm2" | "nginx" | "ssl";
  attempted: boolean;
  ok: boolean;
  detail?: string;
  data?: unknown;
}

export interface LaunchResult {
  domain: string;
  port: number;
  steps: ProvisionStep[];
}

export type SslMode = "cloudflare-http80" | "letsencrypt-strict";

function envEnabled(name: string, defaultValue = "1"): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue === "1";
  return raw !== "0" && raw.toLowerCase() !== "false";
}

/**
 * Probe a TCP port on the loopback interface to see whether the OS will let
 * an application bind it. This is the live counterpart to the database check:
 * a port recorded as free in the DB can still be occupied by a process that
 * was started outside the panel (an operator's manual `pm2 start`, a stray
 * listener, etc.).
 */
export function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      resolve(false);
      return;
    }
    const server = net.createServer();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        server.close();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    server.once("error", () => finish(false));
    server.once("listening", () => finish(true));
    try {
      server.listen(port, host);
    } catch {
      finish(false);
    }
  });
}

/**
 * Yield candidate application ports, skipping reserved platform ports and
 * ports already claimed by a stored project/website. Starts at the configured
 * base (default 3063, matching `alo-server-lap`'s registry) and walks upward.
 */
export function* portCandidates(
  used: Iterable<number>,
  preferredStart: number,
): Generator<number> {
  const occupied = new Set<number>(ALO_SERVER_SPEC.portAllocation.reservedPorts);
  for (const p of used) if (Number.isInteger(p) && p > 0) occupied.add(p);

  const start = Math.max(1024, Math.trunc(preferredStart));
  const end = ALO_SERVER_SPEC.portAllocation.rangeEnd;
  for (let candidate = start; candidate <= end; candidate++) {
    if (!occupied.has(candidate)) yield candidate;
  }
  // Ephemeral fallback range when the managed range is exhausted.
  for (let candidate = 4000; candidate <= 49_151; candidate++) {
    if (!occupied.has(candidate)) yield candidate;
  }
}

/**
 * Allocate a free application port, checking the database (GitProject ports +
 * Website applicationPorts), the reserved platform port registry, AND a live
 * OS-level TCP bind probe. This replaces the previous DB-only allocation that
 * started at 4100 and could hand out a port an OS process already owns.
 */
export async function allocateFreePort(preferredStart?: number): Promise<number> {
  const used: number[] = [];
  for (const p of await db.gitProject.findMany({ select: { port: true } })) {
    if (p.port) used.push(p.port);
  }
  for (const w of await db.website.findMany({
    where: { deletedAt: null },
    select: { applicationPort: true },
  })) {
    if (w.applicationPort) used.push(w.applicationPort);
  }

  const start = preferredStart ?? Number(process.env.DEPLOY_PORT_START || ALO_SERVER_SPEC.portAllocation.nextStartPort);
  for (const candidate of portCandidates(used, start)) {
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error("No free application port available (DB + OS probe exhausted)");
}

/** Register and start a PM2 process for a site via `alo-app-helper up`. */
export async function provisionPm2Process(input: {
  domain: string;
  port: number;
  startCommand: string;
  healthPath: string;
}): Promise<ProvisionStep> {
  if (!envEnabled("ALO_PROVISION_PM2")) {
    return { step: "pm2", attempted: false, ok: false, detail: "PM2 provisioning disabled by ALO_PROVISION_PM2" };
  }
  const r = await callHelper("alo-app-helper", [
    "up",
    input.domain,
    String(input.port),
    "node",
    input.startCommand,
    input.healthPath,
  ], 60_000);
  if (!r.success) {
    return { step: "pm2", attempted: true, ok: false, detail: r.stderr || "alo-app-helper up failed" };
  }
  let data: unknown = null;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    data = r.stdout.slice(0, 500);
  }
  return { step: "pm2", attempted: true, ok: true, data };
}

/** Write + enable + reload a Nginx server block via `alo-nginx-helper site-add`. */
export async function provisionNginxSite(input: {
  domain: string;
  port: number;
  sslMode?: SslMode;
}): Promise<ProvisionStep> {
  if (!envEnabled("ALO_PROVISION_NGINX")) {
    return { step: "nginx", attempted: false, ok: false, detail: "Nginx provisioning disabled by ALO_PROVISION_NGINX" };
  }
  const mode = input.sslMode ?? "cloudflare-http80";
  const r = await callHelper("alo-nginx-helper", ["site-add", input.domain, String(input.port), mode], 60_000);
  if (!r.success) {
    return { step: "nginx", attempted: true, ok: false, detail: r.stderr || "alo-nginx-helper site-add failed" };
  }
  let data: unknown = null;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    data = r.stdout.slice(0, 500);
  }
  return { step: "nginx", attempted: true, ok: true, data };
}

/** Issue a Let's Encrypt certificate via `alo-certbot-helper issue`. */
export async function provisionSsl(input: { domain: string; email?: string }): Promise<ProvisionStep> {
  if (!envEnabled("ALO_PROVISION_SSL")) {
    return { step: "ssl", attempted: false, ok: false, detail: "SSL provisioning disabled by ALO_PROVISION_SSL" };
  }
  const email = input.email || process.env.ALO_CERTBOT_EMAIL || undefined;
  const args = ["issue", input.domain];
  if (email) args.push(email);
  const r = await callHelper("alo-certbot-helper", args, 5 * 60_000);
  if (!r.success) {
    return { step: "ssl", attempted: true, ok: false, detail: r.stderr || "alo-certbot-helper issue failed" };
  }
  let data: unknown = null;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    data = r.stdout.slice(0, 500);
  }
  return { step: "ssl", attempted: true, ok: true, data };
}

/**
 * Programmatic launch of a site from the dashboard: allocate a free port,
 * register + start the PM2 process, write + enable + reload the Nginx vhost,
 * and issue a Certbot certificate.
 *
 * Port allocation is mandatory (it throws if nothing is free). The three
 * provisioning steps are best-effort: a missing helper on the host logs a
 * warning and leaves that step reported as failed without aborting the launch
 * (the site record is still created and the port is reserved).
 */
export async function launchSite(input: {
  domain: string;
  startCommand: string;
  healthPath?: string;
  port?: number;
  sslMode?: SslMode;
  email?: string;
}): Promise<LaunchResult> {
  const domain = input.domain.trim().toLowerCase();
  const healthPath = input.healthPath || "/";
  const port = input.port ?? (await allocateFreePort());

  const steps: ProvisionStep[] = [];

  steps.push({ step: "port", attempted: true, ok: true, data: { port } });

  const pm2 = await provisionPm2Process({ domain, port, startCommand: input.startCommand, healthPath });
  steps.push(pm2);

  const nginx = await provisionNginxSite({ domain, port, sslMode: input.sslMode });
  steps.push(nginx);

  const ssl = await provisionSsl({ domain, email: input.email });
  steps.push(ssl);

  for (const step of steps) {
    if (step.attempted && !step.ok) {
      logger.warn({ domain, step: step.step, detail: step.detail }, "launch provisioning step did not complete");
    }
  }

  return { domain, port, steps };
}

/**
 * Best-effort Nginx + SSL provisioning used by the deployment engine after a
 * release is activated. Unlike `launchSite`, this does NOT manage the PM2
 * process (the engine already restarts it through `restartExternalService`);
 * it only ensures the reverse-proxy entry and certificate exist for the
 * domain. Failures are reported but never throw, so a deployment on a host
 * without Nginx/Certbot still succeeds.
 */
export async function provisionRuntime(input: {
  domain: string;
  port: number;
  sslMode?: SslMode;
}): Promise<{ nginx: ProvisionStep; ssl: ProvisionStep }> {
  const nginx = await provisionNginxSite({ domain: input.domain, port: input.port, sslMode: input.sslMode }).catch((error) => ({
    step: "nginx" as const,
    attempted: true,
    ok: false,
    detail: redact(error instanceof Error ? error.message : String(error)),
  }));
  const ssl = await provisionSsl({ domain: input.domain }).catch((error) => ({
    step: "ssl" as const,
    attempted: true,
    ok: false,
    detail: redact(error instanceof Error ? error.message : String(error)),
  }));
  for (const step of [nginx, ssl]) {
    if (step.attempted && !step.ok) {
      logger.warn({ domain: input.domain, step: step.step, detail: step.detail }, "runtime provisioning step did not complete");
    }
  }
  return { nginx, ssl };
}
