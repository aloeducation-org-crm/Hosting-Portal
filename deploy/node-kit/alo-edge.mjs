#!/usr/bin/env node
/**
 * ALO Labs — managed edge reverse proxy (part of deploy/node-kit).
 *
 * A real, host-level L7 proxy for compute nodes that do not run Caddy/nginx.
 * It is installed once per host by deploy/node-kit/install.sh and runs under
 * PM2 (or the provided systemd unit) as the unprivileged `alo-panel` user.
 *
 *   - HTTP (default :80) and, once certificates exist, HTTPS (default :443)
 *   - host-based routing: /etc/alo-hosting/edge/sites/<domain>.json
 *     { "domain": ..., "upstream": "127.0.0.1:4100", "tls": true }
 *   - per-domain TLS from /etc/alo-hosting/tls/<domain>/{fullchain,privkey}.pem
 *     (issued by alo-ssl-helper: ACME where authorized, internal CA otherwise)
 *   - unknown hosts get 404; /alo-edge/healthz reports the proxy's own state
 *   - config changes are picked up without restart (mtime-checked cache)
 *
 * Deliberate scope limits: no wildcard routes, no config from the network, no
 * process spawning. It only proxies to loopback upstreams.
 */
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const SITES_DIR = process.env.ALO_EDGE_SITES_DIR || "/etc/alo-hosting/edge/sites";
const TLS_BASE = process.env.ALO_EDGE_TLS_BASE || "/etc/alo-hosting/tls";
const HTTP_PORT = Number(process.env.ALO_EDGE_HTTP_PORT || 80);
const HTTPS_PORT = Number(process.env.ALO_EDGE_HTTPS_PORT || 443);
const BIND = process.env.ALO_EDGE_BIND || "0.0.0.0";

/** domain -> { upstream, tls } with mtime-based cache; never trusts the network. */
const cache = new Map(); // domain -> { config, cert, key, loadedAt }
const dirState = { mtimeMs: 0, checkedAt: 0 };
const CERT_TTL_MS = 30_000;

function validDomain(d) {
  return typeof d === "string" && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(d) && !d.includes("..");
}

async function refreshDirState() {
  const now = Date.now();
  if (now - dirState.checkedAt < 1000) return;
  dirState.checkedAt = now;
  try {
    const stat = await fsp.stat(SITES_DIR);
    dirState.mtimeMs = stat.mtimeMs;
  } catch {
    dirState.mtimeMs = 0;
  }
}

async function loadSite(domain) {
  if (!validDomain(domain)) return null;
  const entry = cache.get(domain);
  const now = Date.now();
  if (entry && now - entry.loadedAt < CERT_TTL_MS && entry.mtimeMs === dirState.mtimeMs) return entry;
  const file = path.join(SITES_DIR, `${domain}.json`);
  let config = null;
  try {
    config = JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    if (entry) return entry; // a failed reload keeps the last known-good route
    return null;
  }
  if (!config || !validDomain(config.domain) || typeof config.upstream !== "string") return entry ?? null;
  const upstream = config.upstream;
  if (!/^127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(upstream)) return entry ?? null;
  let cert = entry?.cert ?? null;
  let key = entry?.key ?? null;
  if (config.tls) {
    try {
      const certPem = await fsp.readFile(path.join(TLS_BASE, domain, "fullchain.pem"), "utf8");
      const keyPem = await fsp.readFile(path.join(TLS_BASE, domain, "privkey.pem"), "utf8");
      cert = certPem;
      key = keyPem;
    } catch {
      cert = null;
      key = null;
    }
  }
  const loaded = { config: { domain: config.domain, upstream, tls: Boolean(config.tls) }, cert, key, loadedAt: now, mtimeMs: dirState.mtimeMs };
  cache.set(domain, loaded);
  return loaded;
}

function proxyRequest(req, res, upstream, extraHeaders = {}) {
  const target = new URL(req.url ?? "/", `http://${upstream}`);
  const headers = { ...req.headers, host: upstream, ...extraHeaders };
  delete headers["connection"];
  const proxyReq = http.request(
    {
      hostname: target.hostname,
      port: Number(target.port),
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );
  proxyReq.on("error", (error) => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json", "X-ALO-Edge": "upstream-unreachable" });
    res.end(JSON.stringify({ error: "upstream unreachable" }));
    console.error(`[alo-edge] upstream ${upstream} failed: ${error?.message ?? error}`);
  });
  req.pipe(proxyReq, { end: true });
}

function hostOf(req) {
  const raw = String(req.headers.host ?? "").split(":")[0] ?? "";
  return raw.toLowerCase().replace(/\.$/, "");
}

async function handler(req, res) {
  await refreshDirState();
  const url = new URL(req.url ?? "/", "http://edge.internal");
  if (url.pathname === "/alo-edge/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, pid: process.pid, uptimeSeconds: Math.round(process.uptime()), sites: cache.size }));
    return;
  }
  const host = hostOf(req);
  const site = host ? await loadSite(host) : null;
  if (!site) {
    res.writeHead(404, { "Content-Type": "application/json", "X-ALO-Edge": "unknown-host" });
    res.end(JSON.stringify({ error: `no site is configured for ${host || "(no host header)"}` }));
    return;
  }
  proxyRequest(req, res, site.config.upstream, {
    "x-forwarded-host": host,
    "x-forwarded-proto": req.socket.encrypted ? "https" : "http",
    "x-forwarded-for": req.socket.remoteAddress ?? "",
  });
}

const httpServer = http.createServer(handler);
httpServer.on("clientError", (_err, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
httpServer.listen(HTTP_PORT, BIND, () => {
  console.log(`[alo-edge] http listening on ${BIND}:${HTTP_PORT} (sites: ${SITES_DIR})`);
  writeStateFile();
});

// Node-local port discovery: helpers on this host read this file to learn
// which listener ports the edge actually bound (e.g. when 80/443 are taken
// and the operator runs the edge on high ports). The installer pre-creates
// this file root:alo-panel 0640 so the unprivileged edge can only rewrite it,
// never relocate it. Best-effort only.
function writeStateFile() {
  const statePath = path.join(path.dirname(SITES_DIR), "state.json");
  fsp.writeFile(statePath, JSON.stringify({ pid: process.pid, bind: BIND, httpPort: HTTP_PORT, httpsPort: HTTPS_PORT, updatedAt: new Date().toISOString() }, null, 2) + "\n")
    .catch(() => {}); // read-only fs or missing dir: helpers fall back to defaults
}

let httpsServer = null;
function tryEnableHttps() {
  if (httpsServer) return;
  // Enable the TLS listener lazily: hosts commonly install the edge before any
  // certificate exists. The TLS base directory itself is not polled per tick —
  // enabling is checked when the ssl helper signals us (SIGHUP) or on interval.
  try {
    httpsServer = https.createServer(
      {
        SNICallback: (servername, cb) => {
          const host = String(servername ?? "").toLowerCase();
          loadSite(host).then((site) => {
            if (site?.cert && site?.key) cb(null, tls.createSecureContext({ cert: site.cert, key: site.key }));
            else cb(null, tls.createSecureContext({})); // handshake fails; no cert for this name
          }).catch(() => cb(null, tls.createSecureContext({})));
        },
      },
      (req, res) => {
        // Without SNI-matched certs the SNICallback already fails the
        // handshake; this path only runs for names that resolved.
        handler(req, res);
      },
    );
    httpsServer.listen(HTTPS_PORT, BIND, () => {
      console.log(`[alo-edge] https listening on ${BIND}:${HTTPS_PORT} (certs: ${TLS_BASE})`);
    });
    httpsServer.on("error", (error) => {
      console.error(`[alo-edge] https listener unavailable: ${error?.message ?? error}`);
      httpsServer = null;
    });
  } catch (error) {
    console.error(`[alo-edge] https setup failed: ${error?.message ?? error}`);
    httpsServer = null;
  }
}

// Reload certificates + site config on demand.
process.on("SIGHUP", () => {
  const now = Date.now();
  for (const [domain, entry] of cache) cache.set(domain, { ...entry, loadedAt: 0 });
  dirState.checkedAt = 0;
  tryEnableHttps();
  console.log(`[alo-edge] reload signalled at ${new Date(now).toISOString()} (requestId ${crypto.randomUUID().slice(0, 8)})`);
});

setInterval(() => {
  tryEnableHttps();
}, 30_000).unref();

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
    httpsServer?.close(() => {});
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
