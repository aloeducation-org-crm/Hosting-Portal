/**
 * URL & SSRF / Cloud-Metadata Guards.
 *
 * Used across AI provider configuration, customer webhook registration, and
 * service readiness checks to prevent Server-Side Request Forgery (SSRF) against
 * cloud metadata endpoints (AWS/GCP/Azure/Alibaba IMDS), link-local addresses,
 * and unauthorized internal network ranges.
 */

function parseIpv4Octets(host: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = [
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    Number.parseInt(match[3]!, 10),
    Number.parseInt(match[4]!, 10),
  ] as [number, number, number, number];
  if (octets.some((n) => n < 0 || n > 255)) return null;
  return octets;
}

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/**
 * Returns true when `hostname` targets cloud instance metadata services (IMDS),
 * IPv4/IPv6 link-local addresses, or unspecified `0.0.0.0` / `::`.
 * These must NEVER be contacted by any provider or webhook, even on self-hosted setups.
 */
export function isCloudMetadataOrLinkLocalHost(rawHostname: string): boolean {
  const host = stripBrackets(rawHostname.trim());
  if (!host) return true;

  if (
    host === "0.0.0.0" ||
    host === "::" ||
    host === "metadata" ||
    host === "metadata.google.internal" ||
    host.endsWith(".metadata.google.internal") ||
    host === "metadata.azure.com" ||
    host === "instance-data" ||
    host === "100.100.100.200"
  ) {
    return true;
  }

  // IPv6 AWS IMDS (fd00:ec2::254), link-local fe80::/10, or IPv4-mapped ::ffff:169.254.x.x
  if (
    host.startsWith("fd00:ec2:") ||
    host.startsWith("fe80:") ||
    host.startsWith("fe90:") ||
    host.startsWith("fea0:") ||
    host.startsWith("feb0:") ||
    host.includes("169.254.")
  ) {
    return true;
  }

  const ipv4 = parseIpv4Octets(host);
  if (ipv4) {
    const [a, b] = ipv4;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 AWS/GCP/Azure IMDS
  }

  return false;
}

/**
 * Returns true when `hostname` resolves by syntax to loopback, RFC1918 private
 * networks, Tailscale/CGNAT (`100.64.0.0/10`), IPv6 ULA (`fc00::/7`), or internal suffixes.
 */
export function isPrivateOrLoopbackHost(rawHostname: string): boolean {
  const host = stripBrackets(rawHostname.trim());
  if (!host) return true;
  if (isCloudMetadataOrLinkLocalHost(host)) return true;

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host === "::1"
  ) {
    return true;
  }

  if (host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }

  const ipv4 = parseIpv4Octets(host);
  if (ipv4) {
    const [a, b] = ipv4;
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT / Tailscale
  }

  return false;
}

export interface WebhookUrlValidation {
  ok: boolean;
  normalizedUrl?: string;
  reason?: string;
}

/**
 * Validates customer-supplied outbound webhook URLs.
 * Enforces HTTPS (unless ALLOW_INSECURE_WEBHOOK_HTTP=true in local tests),
 * rejects embedded credentials, and blocks loopback, RFC1918, and IMDS hosts.
 */
export function validateExternalWebhookUrl(
  raw: string,
  options: { allowHttp?: boolean } = {},
): WebhookUrlValidation {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) {
    return { ok: false, reason: "Webhook URL must be a non-empty URL up to 2048 characters" };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Invalid URL format" };
  }

  const allowHttp = options.allowHttp ?? process.env.ALLOW_INSECURE_WEBHOOK_HTTP === "true";
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) {
    return { ok: false, reason: "Webhook URL must use https://" };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Credentials in webhook URLs are not allowed" };
  }

  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return {
      ok: false,
      reason: "Webhook URL cannot target loopback, private network, or cloud metadata addresses",
    };
  }

  parsed.hash = "";
  return { ok: true, normalizedUrl: parsed.toString() };
}
