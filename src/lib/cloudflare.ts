import { env } from "@/lib/env";

export interface CloudflareDnsRecordInput {
  type: "A" | "AAAA" | "CNAME" | "TXT" | "MX";
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
  /** Optional explicit Cloudflare Zone ID for multi-domain accounts. */
  zoneId?: string;
}

export interface CloudflareOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Kept for compatibility; this module never returns a simulated success. */
  simulated?: boolean;
}

const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const ZONE_CACHE_TTL_MS = 5 * 60_000;
const zoneCache = new Map<string, { zoneId: string; expiresAt: number }>();

function hasApiToken(): boolean {
  return Boolean(env.CLOUDFLARE_API_TOKEN);
}

function isConfigured(): boolean {
  return Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID);
}

async function cf<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; result?: T; error?: string }> {
  try {
    const res = await fetch(`${CF_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as {
      success?: boolean;
      result?: T;
      errors?: Array<{ message: string }>;
    };
    if (!res.ok || !json.success) {
      return {
        ok: false,
        error: json.errors?.[0]?.message ?? `Cloudflare API returned HTTP ${res.status}`,
      };
    }
    return { ok: true, result: json.result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Cloudflare request failed",
    };
  }
}

/**
 * Resolves the Cloudflare Zone ID for any hosted domain (supporting multiple
 * zones across ALO Education, TECH360, ALO Marketing, and customer domains).
 * Walks candidate apex names from most specific to root, caching results for
 * 5 minutes, and falls back to `CLOUDFLARE_ZONE_ID` when the hostname is a
 * relative label like `@` or `www`.
 */
export async function resolveCloudflareZoneId(
  hostname: string,
  explicitZoneId?: string,
): Promise<string | null> {
  if (explicitZoneId?.trim()) return explicitZoneId.trim();
  const cleaned = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!cleaned || !cleaned.includes(".")) {
    return env.CLOUDFLARE_ZONE_ID || null;
  }

  const labels = cleaned.split(".");
  const candidates: string[] = [];
  for (let i = 0; i <= labels.length - 2; i += 1) {
    candidates.push(labels.slice(i).join("."));
  }

  const now = Date.now();
  for (const candidate of candidates) {
    const cached = zoneCache.get(candidate);
    if (cached && cached.expiresAt > now) {
      return cached.zoneId;
    }
  }

  if (hasApiToken()) {
    for (const candidate of candidates) {
      const lookup = await cf<Array<{ id: string; name: string }>>(
        `/zones?name=${encodeURIComponent(candidate)}&status=active`,
      );
      const matchedZone = lookup.result?.[0];
      if (lookup.ok && matchedZone) {
        const zoneId = matchedZone.id;
        zoneCache.set(candidate, { zoneId, expiresAt: now + ZONE_CACHE_TTL_MS });
        return zoneId;
      }
    }
  }

  return env.CLOUDFLARE_ZONE_ID || null;
}

/** Real idempotent upsert: find an exact match, update it, or create it. */
export async function upsertCloudflareDnsRecord(
  record: CloudflareDnsRecordInput,
): Promise<CloudflareOperationResult<{ id: string; name: string; type: string; content: string; proxied: boolean }>> {
  if (!hasApiToken()) {
    return {
      success: false,
      error: "CLOUDFLARE_NOT_CONFIGURED: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are required. No DNS record was changed.",
    };
  }
  const zoneId = await resolveCloudflareZoneId(record.name, record.zoneId);
  if (!zoneId) {
    return {
      success: false,
      error: "CLOUDFLARE_NOT_CONFIGURED: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are required (or a matching Cloudflare zone must exist). No DNS record was changed.",
    };
  }

  const query = new URLSearchParams({ type: record.type, name: record.name });
  const found = await cf<Array<{ id: string; content: string }>>(`/zones/${zoneId}/dns_records?${query}`);
  if (!found.ok) return { success: false, error: found.error };

  const body = JSON.stringify({
    type: record.type,
    name: record.name,
    content: record.content,
    ttl: record.ttl ?? 1,
    proxied: record.proxied ?? false,
    ...(record.priority !== undefined ? { priority: record.priority } : {}),
  });
  const existing = found.result?.find((r) => r.content === record.content) ?? found.result?.[0];
  const saved = existing
    ? await cf<{ id: string; name: string; type: string; content: string; proxied: boolean }>(
        `/zones/${zoneId}/dns_records/${existing.id}`,
        { method: "PATCH", body },
      )
    : await cf<{ id: string; name: string; type: string; content: string; proxied: boolean }>(
        `/zones/${zoneId}/dns_records`,
        { method: "POST", body },
      );

  if (!saved.ok || !saved.result) {
    return { success: false, error: saved.error ?? "Cloudflare did not return the saved record" };
  }
  return { success: true, data: saved.result };
}

/** Real external deletion when the provider record ID (or exact lookup) is known. */
export async function deleteCloudflareDnsRecord(params: {
  hostname: string;
  providerRecordId: string;
  zoneId?: string;
}): Promise<CloudflareOperationResult<{ id: string }>> {
  if (!isConfigured() && !hasApiToken()) {
    return {
      success: false,
      error: "CLOUDFLARE_NOT_CONFIGURED: CLOUDFLARE_API_TOKEN is required to delete external DNS records.",
    };
  }
  const zoneId = await resolveCloudflareZoneId(params.hostname, params.zoneId);
  if (!zoneId) {
    return { success: false, error: "Could not resolve Cloudflare zone for deletion." };
  }
  const deleted = await cf<{ id: string }>(
    `/zones/${zoneId}/dns_records/${encodeURIComponent(params.providerRecordId)}`,
    { method: "DELETE" },
  );
  if (!deleted.ok) {
    return { success: false, error: deleted.error ?? "Cloudflare delete failed" };
  }
  return { success: true, data: { id: params.providerRecordId } };
}

/**
 * Cloudflare Universal SSL is not an ACME issuance API. This function refuses
 * to fabricate a certificate/expiry; use the enrolled-node ACME handler or
 * observe the live edge certificate instead.
 */
export async function provisionCloudflareSSL(
  domain: string,
): Promise<CloudflareOperationResult<{ domain: string; status: string; issuer: string; expiresAt: string }>> {
  void domain;
  return {
    success: false,
    error: "NOT_IMPLEMENTED: Cloudflare certificate issuance is not wired to a verified provider API. No certificate was issued and no expiry was invented.",
  };
}
