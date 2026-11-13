#!/usr/bin/env node
/**
 * ALO Labs — node-side static release server (part of deploy/node-kit).
 *
 * Runs on a compute node as the unprivileged `alo-panel` user (supervised by
 * PM2) and serves the *current symlink target* of one site, mirroring the
 * panel's own static manager semantics (src/lib/deploy/service.ts):
 *
 *   - files are served from <site>/current/<root>
 *   - GET /__alo_release.json returns the release marker (alo-deploy.json)
 *   - every response carries X-ALO-Commit so verification can prove which
 *     commit is actually live
 *   - path traversal is refused
 *
 * Usage (argv only, validated by alo-app-helper):
 *   alo-static-server.mjs --site /srv/alo-sites/example.internal \
 *                         --root . --port 4100
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const SITE_DIR = arg("site");
const ROOT_REL = (arg("root") || ".").replace(/^\./, "").replace(/^\/+/, "") || "";
const PORT = Number(arg("port") || 0);
const BIND = process.env.ALO_BIND_HOST || "127.0.0.1";
const MARKER_PATH = "/__alo_release.json";
const MARKER_FILE = "alo-deploy.json";

if (!SITE_DIR || !/^\//.test(SITE_DIR) || SITE_DIR.includes("..")) {
  console.error("[alo-static-server] --site must be an absolute site directory");
  process.exit(64);
}
if (ROOT_REL.includes("..")) {
  console.error("[alo-static-server] --root must be a relative path without '..'");
  process.exit(64);
}
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  console.error("[alo-static-server] --port must be 1024-65535");
  process.exit(64);
}

async function currentDir() {
  try {
    return await fs.realpath(path.join(SITE_DIR, "current"));
  } catch {
    return null;
  }
}

async function readMarker(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, MARKER_FILE), "utf8"));
  } catch {
    return null;
  }
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  try {
    const active = await currentDir();
    if (!active) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no active release" }));
      return;
    }
    const marker = await readMarker(active);
    const commitHeader = marker?.commitSha ?? "none";
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname === MARKER_PATH) {
      res.writeHead(marker ? 200 : 404, {
        "Content-Type": "application/json",
        "X-ALO-Commit": commitHeader,
      });
      res.end(JSON.stringify(marker ?? { error: "marker missing" }));
      return;
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const serveRoot = path.join(active, ROOT_REL);
    const filePath = path.resolve(serveRoot, rel);
    // Path traversal guard: the resolved file must stay inside the release.
    if (filePath !== serveRoot && !filePath.startsWith(serveRoot + path.sep)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("forbidden");
      return;
    }
    const stat = await fs.stat(filePath).catch(() => null);
    const finalPath = stat?.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const body = await fs.readFile(finalPath).catch(() => null);
    if (!body) {
      res.writeHead(404, { "Content-Type": "text/plain", "X-ALO-Commit": commitHeader });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(finalPath)] ?? "application/octet-stream",
      "X-ALO-Commit": commitHeader,
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "server error" }));
    console.error("[alo-static-server] request failed:", error?.message ?? error);
  }
});

server.listen(PORT, BIND, () => {
  console.log(`[alo-static-server] serving ${SITE_DIR}/current/${ROOT_REL || "."} on ${BIND}:${PORT} (pid ${process.pid})`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
