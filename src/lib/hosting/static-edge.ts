import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { STATIC_EDGE_ID, STATIC_LIMITS, STATIC_MANIFEST, STATIC_MARKER_PATH, isStaticHostname, staticAssetType, type StaticHostingConfig } from "./static-config";

export interface StaticReleaseMarker {
  version: 1;
  siteId: string;
  hostname: string;
  commitSha: string;
  treeSha: string;
  indexSha256: string;
  files: number;
  bytes: number;
}

/** Open only regular files below the exact canonical release path. File modes
 * and symlink rules are also enforced when packaging the Git tree. */
export async function openStaticFile(root: string, siteDir: string, relative: string, maxBytes: number) {
  const file = path.join(siteDir, relative);
  if (!siteDir.startsWith(`${root}${path.sep}`) || !file.startsWith(`${siteDir}${path.sep}`) || await realpath(file) !== file) {
    throw new Error("Noncanonical static asset");
  }
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error("Unsupported static asset");
    return { fd, size: stat.size };
  } catch (error) {
    await fd.close();
    throw error;
  }
}

export async function requireStaticRoot(root: string): Promise<void> {
  if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw new Error("Static root must be a real directory");
}

/** No cookies, database, credentials, interpreters or shell in the serving
 * plane. The edge listens on loopback behind the operator's TLS ingress. */
export function createStaticEdge(config: StaticHostingConfig) {
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 5_000, keepAliveTimeout: 3_000 }, async (req, res) => {
    res.setHeader("X-ALO-Static-Edge", STATIC_EDGE_ID);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    const notFound = () => { res.statusCode = 404; res.end("Not found"); };
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const hostname = (req.headers.host ?? "").toLowerCase().replace(/:\d{1,5}$/, "");
    if (!isStaticHostname(hostname, config.domain)) return notFound();
    const requested = (req.url ?? "").split("?", 1)[0] ?? "";
    if (!requested.startsWith("/") || requested.startsWith("//")) return notFound();
    const marker = requested === STATIC_MARKER_PATH;
    const relative = marker ? STATIC_MANIFEST : requested.endsWith("/") ? `${requested.slice(1)}index.html` : requested.slice(1);
    const contentType = marker ? "application/json" : staticAssetType(relative);
    if (!contentType) return notFound();
    try {
      const { fd, size } = await openStaticFile(config.root, path.join(config.root, hostname), relative, marker ? 4096 : STATIC_LIMITS.fileBytes);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", size);
      if (req.method === "HEAD" || !size) {
        await fd.close();
        res.end();
      } else {
        await pipeline(fd.createReadStream({ start: 0, end: size - 1 }), res);
      }
    } catch {
      if (!res.headersSent && !res.destroyed) {
        res.removeHeader("Content-Length");
        res.removeHeader("Content-Type");
        res.setHeader("Cache-Control", "no-store");
        notFound();
      } else res.destroy();
    }
  });  server.maxConnections = 1024;
  server.setTimeout(15_000, (socket) => socket.destroy());
  return server;
}
