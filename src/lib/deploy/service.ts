import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redact } from "./redact";
import type { ReleaseMarker, ServiceManager } from "./types";

const execFileAsync = promisify(execFile);
const MARKER_FILE = "alo-deploy.json";
const MARKER_PATH = "/__alo_release.json";

const servers = new Map<number, { server: http.Server; root: string }>();

/** Every release path is derived from a server-side base + validated ids. */
export function releaseBase(): string {
  const base = process.env.DEPLOY_RELEASE_BASE || path.join(os.tmpdir(), "alo-releases");
  if (!path.isAbsolute(base)) throw new Error("DEPLOY_RELEASE_BASE must be absolute");
  return path.resolve(/*turbopackIgnore: true*/ base);
}

export function projectRoot(projectId: string): string {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(projectId)) throw new Error("Invalid project id");
  return path.join(releaseBase(), projectId);
}

export function releasePath(projectId: string, sha: string, deploymentId: string): string {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("Invalid commit sha");
  return path.join(projectRoot(projectId), "releases", `${sha.slice(0, 12)}-${deploymentId.replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`);
}

export async function writeMarker(dir: string, marker: ReleaseMarker): Promise<void> {
  await fs.writeFile(path.join(dir, MARKER_FILE), JSON.stringify(marker, null, 2), "utf8");
}

export async function readMarker(dir: string): Promise<ReleaseMarker | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, MARKER_FILE), "utf8")) as ReleaseMarker;
  } catch {
    return null;
  }
}

/** Atomic symlink swap. Returns the previously active release directory. */
export async function activateRelease(projectId: string, target: string): Promise<string | null> {
  const root = projectRoot(projectId);
  await fs.mkdir(path.join(root, "releases"), { recursive: true });
  const link = path.join(root, "current");
  let previous: string | null = null;
  try {
    previous = await fs.realpath(link);
  } catch {
    previous = null;
  }
  if (previous === target) return previous;
  const tmp = path.join(root, `.current-${process.pid}-${Date.now()}`);
  await fs.symlink(target, tmp, "dir");
  try {
    await fs.rename(tmp, link);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  return previous;
}

export async function restoreRelease(projectId: string, previous: string | null): Promise<void> {
  if (previous) await activateRelease(projectId, previous);
  else await fs.rm(path.join(projectRoot(projectId), "current"), { force: true }).catch(() => {});
}

export async function currentReleaseDir(projectId: string): Promise<string | null> {
  try {
    return await fs.realpath(path.join(projectRoot(projectId), "current"));
  } catch {
    return null;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/**
 * A real (if minimal) service manager for static/Vite/SPA releases. It serves
 * the *current symlink target* on the configured port and exposes the release
 * marker over HTTP so verification can prove which commit is actually live.
 * PM2/systemd integration uses restartExternalService() instead.
 */
export async function startStaticServer(port: number, root: string): Promise<void> {
  const existing = servers.get(port);
  if (existing && existing.root === root && existing.server.listening) return;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const active = await currentReleaseDir(path.basename(root));
      if (!active) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "no active release" }));
        return;
      }
      if (url.pathname === MARKER_PATH) {
        const marker = await readMarker(active);
        res.writeHead(marker ? 200 : 404, {
          "Content-Type": "application/json",
          "X-ALO-Commit": marker?.commitSha ?? "none",
        });
        res.end(JSON.stringify(marker ?? { error: "marker missing" }));
        return;
      }
      const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const filePath = path.resolve(/*turbopackIgnore: true*/ active, requested);
      if (filePath !== active && !filePath.startsWith(active + path.sep)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const stat = await fs.stat(/*turbopackIgnore: true*/ filePath).catch(() => null);
      const finalPath = stat?.isDirectory() ? path.join(/*turbopackIgnore: true*/ filePath, "index.html") : filePath;
      const body = await fs.readFile(/*turbopackIgnore: true*/ finalPath).catch(() => null);
      if (!body) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": CONTENT_TYPES[path.extname(finalPath)] ?? "application/octet-stream",
        "X-ALO-Commit": (await readMarker(active))?.commitSha ?? "none",
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: redact(error instanceof Error ? error.message : "server error") }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, process.env.DEPLOY_BIND_HOST || "127.0.0.1", () => resolve());
  });
  servers.set(port, { server, root });
}

export async function stopStaticServer(port: number): Promise<void> {
  const entry = servers.get(port);
  if (!entry) return;
  await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  servers.delete(port);
}

export function activeStaticPorts(): number[] {
  return [...servers.keys()];
}

export async function restartExternalService(manager: ServiceManager, name: string): Promise<void> {
  if (manager !== "pm2" && manager !== "systemd") return;
  if (!/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/.test(name)) throw new Error("Unsafe service name");
  const argv = manager === "pm2" ? ["pm2", "reload", name] : ["systemctl", "restart", name];
  await execFileAsync(argv[0]!, argv.slice(1), { timeout: 30_000 });
}

export interface VerifyResult {
  ok: boolean;
  httpStatus: number | null;
  marker: ReleaseMarker | null;
  reason: string;
  attempts: number;
}

/**
 * Success requires BOTH a healthy response AND an HTTP-served release marker
 * whose commit SHA + deployment id match this deployment. An HTTP 200 from a
 * stale process is not accepted.
 */
export async function verifyDeployment(options: {
  baseUrl: string;
  healthPath: string;
  expectedSha: string;
  expectedDeploymentId: string;
  attempts?: number;
  delayMs?: number;
}): Promise<VerifyResult> {
  const { baseUrl, healthPath, expectedSha, expectedDeploymentId } = options;
  const attempts = options.attempts ?? 12;
  const delayMs = options.delayMs ?? 400;
  let lastStatus: number | null = null;
  let lastReason = "health endpoint never returned 2xx";
  for (let i = 1; i <= attempts; i++) {
    try {
      const health = await fetch(new URL(healthPath, baseUrl).toString(), {
        signal: AbortSignal.timeout(4_000),
        redirect: "manual",
      });
      lastStatus = health.status;
      await health.arrayBuffer().catch(() => null);
      if (health.status >= 200 && health.status < 400) {
        const markerRes = await fetch(new URL(MARKER_PATH, baseUrl).toString(), {
          signal: AbortSignal.timeout(4_000),
        });
        if (markerRes.ok) {
          const marker = (await markerRes.json()) as ReleaseMarker;
          if (marker?.commitSha === expectedSha && marker?.deploymentId === expectedDeploymentId) {
            return { ok: true, httpStatus: health.status, marker, reason: "verified", attempts: i };
          }
          lastReason = `release marker mismatch (live=${marker?.commitSha ?? "none"} expected=${expectedSha})`;
        } else {
          lastReason = `release marker endpoint returned HTTP ${markerRes.status}`;
        }
      } else {
        lastReason = `health endpoint returned HTTP ${health.status}`;
      }
    } catch (error) {
      lastReason = redact(error instanceof Error ? error.message : "health request failed");
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, httpStatus: lastStatus, marker: null, reason: lastReason, attempts };
}
