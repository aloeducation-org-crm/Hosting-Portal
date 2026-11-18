import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { chmod, lstat, mkdir, mkdtemp, rename, rm, statfs, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import https from "node:https";
import path from "node:path";
import { checkServerIdentity } from "node:tls";
import { WorkerError } from "@/lib/orchestrator/contracts";
import { openStaticFile, requireStaticRoot, type StaticReleaseMarker } from "./static-edge";
import { SHA256, UUID, STATIC_EDGE_ID, STATIC_LIMITS, STATIC_MANIFEST, STATIC_MARKER_PATH, isPublicStaticIpv4, isStaticHostname, type StaticHostingConfig } from "./static-config";
import { listStaticAssets, readStaticAsset, type StaticSourcePin } from "./static-source";

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type ReleaseRequest = StaticSourcePin & { siteId: string; hostname: string; repository: string };

function readMatchingMarker(value: unknown, expected: ReleaseRequest): StaticReleaseMarker | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Partial<StaticReleaseMarker>;
  if (m.version !== 1 || m.siteId !== expected.siteId || m.hostname !== expected.hostname || m.commitSha !== expected.commitSha || m.treeSha !== expected.treeSha ||
      typeof m.indexSha256 !== "string" || !SHA256.test(m.indexSha256) || !Number.isInteger(m.files) || m.files! < 1 || m.files! > STATIC_LIMITS.files ||
      !Number.isInteger(m.bytes) || m.bytes! < 1 || m.bytes! > STATIC_LIMITS.releaseBytes) return null;
  return m as StaticReleaseMarker;
}

function heldPath(config: StaticHostingConfig, input: ReleaseRequest) {
  if (!UUID.test(input.siteId)) throw new WorkerError("VALIDATION_FAILED", "Invalid static site identity.", false);
  return path.join(config.root, `.held-${input.siteId}`);
}

export async function existingStaticRelease(config: StaticHostingConfig, input: ReleaseRequest, held = false): Promise<StaticReleaseMarker | null> {
  if (!isStaticHostname(input.hostname, config.domain)) throw new WorkerError("NOT_CONFIGURED", "The site is not in this edge's approved hosting zone.", false);
  try {
    await requireStaticRoot(config.root);
  } catch {
    throw new WorkerError("STATIC_ROOT_UNAVAILABLE", "The operator's static release storage is unavailable.");
  }
  const directory = held ? heldPath(config, input) : path.join(config.root, input.hostname);
  const present = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw new WorkerError("STATIC_ROOT_UNAVAILABLE", "The operator’s static release storage is unavailable.");
  });
  if (!present) return null;
  try {
    const { fd } = await openStaticFile(config.root, directory, STATIC_MANIFEST, 4096);
    try {
      const marker = readMatchingMarker(JSON.parse(await fd.readFile("utf8")), input);
      if (!marker) throw new Error("Release does not match");
      return marker;
    } finally { await fd.close(); }
  } catch {
    throw new WorkerError("VERIFICATION_REQUIRED", "A different or invalid release occupies this hostname. No files were overwritten.", false);
  }
}

export async function publishStaticRelease(config: StaticHostingConfig, input: ReleaseRequest, signal: AbortSignal, authorize: () => Promise<void>): Promise<StaticReleaseMarker> {
  const existing = await existingStaticRelease(config, input);
  if (existing) return existing;
  const retained = await existingStaticRelease(config, input, true);
  if (retained) {
    await authorize();
    signal.throwIfAborted();
    await rename(heldPath(config, input), path.join(config.root, input.hostname));
    return retained;
  }
  const stats = await statfs(config.root, { bigint: true });
  if (stats.bavail * stats.bsize < BigInt(2 * STATIC_LIMITS.releaseBytes)) {
    throw new WorkerError("STATIC_STORAGE_CAPACITY", "The static origin has insufficient free disk space.");
  }
  const assets = await listStaticAssets(input.repository, input.treeSha, signal);
  const stage = await mkdtemp(path.join(config.root, ".stage-"));
  try {
    let bytes = 0;
    let indexSha256 = "";
    for (const asset of assets) {
      signal.throwIfAborted();
      const data = await readStaticAsset(input.repository, asset, signal);
      const dest = path.join(stage, asset.path);
      await mkdir(path.dirname(dest), { recursive: true, mode: 0o750 });
      await writeFile(dest, data, { flag: "wx", mode: 0o640, signal });
      bytes += data.length;
      if (asset.path === "index.html") indexSha256 = digest(data);
    }
    const marker: StaticReleaseMarker = { version: 1, siteId: input.siteId, hostname: input.hostname, commitSha: input.commitSha, treeSha: input.treeSha, indexSha256, files: assets.length, bytes };
    await writeFile(path.join(stage, STATIC_MANIFEST), JSON.stringify(marker), { flag: "wx", mode: 0o640, signal });
    await chmod(stage, 0o750);
    await authorize();
    signal.throwIfAborted();
    // Non-empty release directories cannot be replaced by rename. A replay of
    // the same pinned release reuses its directory; anything else fails closed.
    try { await rename(stage, path.join(config.root, input.hostname)); } catch (error) {
      if (["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        const completed = await existingStaticRelease(config, input);
        if (completed) return completed;
      }
      throw error;
    }
    return marker;
  } catch (error) {
    if (error instanceof WorkerError || signal.aborted) throw error;
    throw new WorkerError("STATIC_WRITE_FAILED", "The static release could not be written safely. Check worker storage and permissions.");
  } finally {
    // The staging path is never routable; only this job's working files are removed.
    await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

/** Withdraw (or roll back a failed first activation) by moving only this
 * release out of the serving tree. Keep its bytes; this is not a backup or a
 * restore. Replays after a crash find the retained copy and do nothing. */
export async function holdStaticRelease(config: StaticHostingConfig, input: ReleaseRequest) {
  const published = await existingStaticRelease(config, input);
  if (!published) return;
  if (await existingStaticRelease(config, input, true)) {
    throw new WorkerError("VERIFICATION_REQUIRED", "A held release already exists; refusing to overwrite it.", false);
  }
  await rename(path.join(config.root, input.hostname), heldPath(config, input));
}

export async function verifyStaticWithdrawal(config: StaticHostingConfig, hostname: string, signal: AbortSignal) {
  if (!isStaticHostname(hostname, config.domain)) throw new WorkerError("NOT_CONFIGURED", "The managed hosting zone has changed.", false);
  try {
    await Promise.all(["/", STATIC_MARKER_PATH].map((asset) => new Promise<void>((resolve, reject) => {
      const request = httpRequest({ hostname: "127.0.0.1", port: config.edgePort, path: asset, method: "HEAD", agent: false,
        headers: { Host: hostname }, signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) }, (response) => {
        response.resume();
        if (response.statusCode === 404 && response.headers["x-alo-static-edge"] === STATIC_EDGE_ID) resolve();
        else reject(new Error("The configured origin still serves the release"));
      });
      request.on("error", reject).end();
    })));
    return new Date().toISOString();
  } catch {
    signal.throwIfAborted();
    throw new WorkerError("STATIC_ORIGIN_NOT_VERIFIED", "Withdrawal could not be verified at the local edge.");
  }
}

type ProbeTarget = { hostname: string; address: string; port: number; tls: boolean };

function getProbeBody(target: ProbeTarget, requestPath: string, limit: number, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = target.tls ? https.request : httpRequest;
    const outgoing = request({
      hostname: target.address, port: target.port, path: requestPath, method: "GET", agent: false,
      headers: { Host: target.hostname, "Cache-Control": "no-cache" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
      ...(target.tls ? { servername: target.hostname, rejectUnauthorized: true,
        checkServerIdentity: (_: string, cert: Parameters<typeof checkServerIdentity>[1]) => checkServerIdentity(target.hostname, cert) } : {}),
    }, (reply) => {
      if (reply.statusCode !== 200 || reply.headers["x-alo-static-edge"] !== STATIC_EDGE_ID) {
        reply.destroy();
        reject(new Error("Health response is not HTTP 200"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      reply.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          reply.destroy();
          reject(new Error("Health response exceeds its size limit"));
        } else chunks.push(chunk);
      });
      reply.once("end", () => resolve(Buffer.concat(chunks, size)));
      reply.once("error", reject);
      reply.once("close", () => { if (!reply.complete) reject(new Error("Incomplete health response")); });
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

async function verifyStaticResponse(target: ProbeTarget, input: ReleaseRequest, marker: StaticReleaseMarker, signal: AbortSignal) {
  const [markerBytes, index] = await Promise.all([
    getProbeBody(target, STATIC_MARKER_PATH, 4096, signal), getProbeBody(target, "/", STATIC_LIMITS.fileBytes, signal),
  ]);
  const observed = readMatchingMarker(JSON.parse(markerBytes.toString("utf8")), input);
  if (!observed || observed.indexSha256 !== marker.indexSha256 || observed.bytes !== marker.bytes || observed.files !== marker.files || digest(index) !== marker.indexSha256) {
    throw new Error("The delivered release is not the pinned release");
  }
}

export async function verifyStaticOrigin(config: StaticHostingConfig, input: ReleaseRequest, marker: StaticReleaseMarker, signal: AbortSignal) {
  try {
    await verifyStaticResponse({ hostname: input.hostname, address: "127.0.0.1", port: config.edgePort, tls: false }, input, marker, signal);
    return new Date().toISOString();
  } catch {
    signal.throwIfAborted();
    throw new WorkerError("STATIC_ORIGIN_NOT_VERIFIED", "The local edge did not serve the pinned release and matching homepage. Verify static edge service and retry.");
  }
}

export type StaticPublicEvidence =
  | { status: "NOT_CONFIGURED"; checkedAt: string }
  | { status: "DNS_NOT_VERIFIED" | "HTTPS_NOT_VERIFIED"; checkedAt: string; ingressIpv4: string }
  | { status: "VERIFIED"; checkedAt: string; ingressIpv4: string; url: string };

export async function verifyStaticPublic(config: StaticHostingConfig, input: ReleaseRequest, marker: StaticReleaseMarker, signal: AbortSignal): Promise<StaticPublicEvidence> {
  const checkedAt = () => new Date().toISOString();
  const ip = config.publicIpv4;
  if (!ip || !isPublicStaticIpv4(ip) || !isStaticHostname(input.hostname, config.domain)) return { status: "NOT_CONFIGURED", checkedAt: checkedAt() };
  const resolver = new Resolver({ timeout: 2_000, tries: 2 });
  const cancel = () => resolver.cancel();
  signal.throwIfAborted();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const [v4, v6] = await Promise.all([resolver.resolve4(input.hostname), resolver.resolve6(input.hostname).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENODATA") return [] as string[];
      throw e;
    })]);
    if (!v4.length || v4.some((address) => address !== ip) || v6.length) return { status: "DNS_NOT_VERIFIED", checkedAt: checkedAt(), ingressIpv4: ip };
  } catch {
    signal.throwIfAborted();
    return { status: "DNS_NOT_VERIFIED", checkedAt: checkedAt(), ingressIpv4: ip };
  } finally { signal.removeEventListener("abort", cancel); }
  try {
    // No redirects, no second DNS lookup, no tenant-chosen network destination.
    // SNI and certificate identity still use the requested managed hostname.
    await verifyStaticResponse({ hostname: input.hostname, address: ip, port: 443, tls: true }, input, marker, signal);
    return { status: "VERIFIED", checkedAt: checkedAt(), ingressIpv4: ip, url: `https://${input.hostname}` };
  } catch {
    signal.throwIfAborted();
    return { status: "HTTPS_NOT_VERIFIED", checkedAt: checkedAt(), ingressIpv4: ip };
  }
}
