import { env } from "@/lib/env";

export interface CloudflareDnsRecordInput {
  type: "A" | "AAAA" | "CNAME" | "TXT" | "MX";
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
}

export interface CloudflareOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Kept for compatibility; this module never returns a simulated success. */
  simulated?: boolean;
}

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

function isConfigured(): boolean {
  return Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID);
}

async function cf<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; result?: T; error?: string }> {
  try {
    const res = await fetch(`${CF_API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json() as { success?: boolean; result?: T; errors?: Array<{ message: string }> };
    if (!res.ok || !json.success) return { ok: false, error: json.errors?.[0]?.message ?? `Cloudflare API returned HTTP ${res.status}` };
    return { ok: true, result: json.result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Cloudflare request failed" };
  }
}

/** Real idempotent upsert: find an exact match, update it, or create it. */
export async function upsertCloudflareDnsRecord(
  record: CloudflareDnsRecordInput,
): Promise<CloudflareOperationResult<{ id: string; name: string; type: string; content: string; proxied: boolean }>> {
  if (!isConfigured()) return { success: false, error: "CLOUDFLARE_NOT_CONFIGURED: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are required. No DNS record was changed." };
  const query = new URLSearchParams({ type: record.type, name: record.name });
  const found = await cf<Array<{ id: string; content: string }>>(`/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records?${query}`);
  if (!found.ok) return { success: false, error: found.error };
  const body = JSON.stringify({ type: record.type, name: record.name, content: record.content, ttl: record.ttl ?? 1, proxied: record.proxied ?? false, ...(record.priority !== undefined ? { priority: record.priority } : {}) });
  const existing = found.result?.find((r) => r.content === record.content) ?? found.result?.[0];
  const saved = existing
    ? await cf<{ id: string; name: string; type: string; content: string; proxied: boolean }>(`/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records/${existing.id}`, { method: "PATCH", body })
    : await cf<{ id: string; name: string; type: string; content: string; proxied: boolean }>(`/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records`, { method: "POST", body });
  if (!saved.ok || !saved.result) return { success: false, error: saved.error ?? "Cloudflare did not return the saved record" };
  return { success: true, data: saved.result };
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
  return { success: false, error: "NOT_IMPLEMENTED: Cloudflare certificate issuance is not wired to a verified provider API. No certificate was issued and no expiry was invented." };
}
