import path from "node:path";
import { BlockList, isIPv4 } from "node:net";
import { getDomain } from "tldts";

export const STATIC_LIMITS = { files: 40, fileBytes: 2 * 1024 ** 2, releaseBytes: 8 * 1024 ** 2 } as const;
export const STATIC_MARKER_PATH = "/.well-known/alo-static-release";
export const STATIC_DEFAULT_PORT = 3187;
export const STATIC_EVIDENCE_TTL_MS = 60 * 60_000;
export const STATIC_EDGE_ID = "alo-managed-static-v1";
export const STATIC_MANIFEST = ".alo-static-release.json";
export const SHA1 = /^[a-f0-9]{40}$/;
export const SHA256 = /^[a-f0-9]{64}$/;
export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const STATIC_SCOPES = ["repo:read", "build:run", "release:write"] as const;

const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const reserved = new Set(["www", "admin", "api", "panel", "mail", "smtp", "imap", "ftp", "autodiscover", "ns1", "ns2"]);
export function isStaticLabel(label: string): boolean {
  return label.length <= 45 && dnsLabel.test(label) && !reserved.has(label);
}

export function isStaticHostname(hostname: string, domain: string): boolean {
  return hostname.length <= 253 && hostname.endsWith(`.${domain}`) && isStaticLabel(hostname.slice(0, -domain.length - 1));
}

const nonPublic = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) nonPublic.addSubnet(address, prefix);
export function isPublicStaticIpv4(value: string): boolean {
  return isIPv4(value) && !nonPublic.check(value);
}

export interface StaticHostingConfig {
  domain: string;
  root: string;
  edgePort: number;
  publicIpv4: string | null;
  maxReservations: number;
}

/** A setting is never evidence of an accessible edge. Operator opt-in only. */
export function staticHostingConfig(env = process.env): StaticHostingConfig | null {
  const domain = env.STATIC_HOSTING_DOMAIN?.trim().toLowerCase();
  const root = env.STATIC_HOSTING_ROOT?.trim();
  const port = env.STATIC_HOSTING_EDGE_PORT?.trim() || String(STATIC_DEFAULT_PORT);
  const publicIpv4 = env.STATIC_HOSTING_PUBLIC_IPV4?.trim() || null;
  const maxReservations = env.STATIC_HOSTING_MAX_RESERVATIONS?.trim() || "25";
  if (!domain || domain.length > 207 || !domain.includes(".") || !domain.split(".").every((label) => dnsLabel.test(label)) || !/[a-z]/.test(domain.split(".").at(-1)!)) return null;
  if (!root || !path.isAbsolute(root) || path.resolve(root) !== root || root === path.parse(root).root) return null;
  if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) return null;
  if (publicIpv4 && !isPublicStaticIpv4(publicIpv4)) return null;
  if (!/^[1-9]\d{0,3}$/.test(maxReservations) || Number(maxReservations) > 1_000) return null;
  // A sibling of the login origin is not an isolated customer content zone.
  const contentDomain = getDomain(domain);
  if (!contentDomain) return null;
  for (const primary of [env.APP_URL, env.NEXTAUTH_URL]) {
    if (!primary) continue;
    let protectedHost: string;
    try { protectedHost = new URL(primary).hostname; } catch { return null; }
    if (protectedHost === domain || protectedHost.endsWith(`.${domain}`) || getDomain(protectedHost) === contentDomain) return null;
  }
  return { domain, root, edgePort: Number(port), publicIpv4, maxReservations: Number(maxReservations) };
}

export function validStaticBranch(value: string): boolean {
  return value.length <= 120 && !value.includes("..") && value.split("/").every((s) => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(s) && !s.endsWith(".lock") && !s.endsWith("."));
}

const assetTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
};

/** Repository and request paths share one contract: no dotfiles, devices,
 * traversal, executable server formats, whitespace, or path normalization. */
export function staticAssetType(asset: string): string | null {
  const segments = asset.split("/");
  if (asset.length > 220 || segments.length > 8 || !segments.every((part) => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,99}$/.test(part))) return null;
  return assetTypes[path.posix.extname(asset).toLowerCase()] ?? null;
}
