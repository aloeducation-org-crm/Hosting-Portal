/**
 * Cloudflare Registrar API client — real domain registration through
 * Cloudflare's Registrar API. This is the implementation that the
 * `registrar` mode in src/lib/dns-provider.ts has been waiting for.
 *
 * Scope: the Registrar API lives under `/accounts/{account_id}/registrar/*`
 * and is distinct from the Zone DNS API in src/lib/cloudflare.ts. The DNS
 * API edits records inside an existing zone; this API orders new domains
 * and manages their registration lifecycle (purchase, renewal, transfer,
 * WHOIS privacy, contact data).
 *
 * Required env (in addition to CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID
 * used by the DNS client):
 *   CLOUDFLARE_ACCOUNT_ID  — the account that owns the Registrar orders
 *   CLOUDFLARE_API_TOKEN   — must carry Account:Registrar:Edit AND
 *                            Zone:DNS:Edit (the latter so createDefaultRecords
 *                            can set up the freshly-registered zone)
 *
 * Docs:
 *   availability: https://developers.cloudflare.com/api/operations/registrar-domains-get-availability
 *   order:         https://developers.cloudflare.com/api/operations/registrar-domains-order
 *
 * Honesty contract: if env is not configured, every exported function
 * returns a structured `{ configured: false }` result. No function in this
 * module fabricates a price, an availability verdict, or an order id.
 */
import { env } from "@/lib/env";

const API_BASE = "https://api.cloudflare.com/client/v4";

export interface RegistrarConfigState {
  configured: boolean;
  missing: string[];
}

export function registrarConfig(): RegistrarConfigState {
  const missing: string[] = [];
  if (!env.CLOUDFLARE_API_TOKEN) missing.push("CLOUDFLARE_API_TOKEN");
  if (!env.CLOUDFLARE_ACCOUNT_ID) missing.push("CLOUDFLARE_ACCOUNT_ID");
  return { configured: missing.length === 0, missing };
}

interface CfResult<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ code: number; message: string }>;
}

async function cf<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const json = (await res.json()) as CfResult<T>;
    if (!res.ok || !json.success) {
      const msg = json.errors?.[0]?.message ?? `Cloudflare returned HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    return { ok: true, result: json.result as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Cloudflare request failed" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Availability
// ─────────────────────────────────────────────────────────────────────────────

export interface DomainAvailability {
  domain: string;
  /** True = the name is purchasable through Cloudflare Registrar today. */
  available: boolean | null;
  premium: boolean;
  /** One-year registration price, in the smallest unit the API returns. */
  price?: {
    amount: string;
    currency: string;
    period: "year";
  };
  renewalPrice?: {
    amount: string;
    currency: string;
    period: "year";
  };
  /** Reason string when availability is null (rate-limited, TLD unsupported). */
  reason?: string;
}

interface CfAvailabilityResponse {
  available: boolean;
  premium?: boolean;
  price?: { amount: string; currency: string; period?: "year" };
  renewal_price?: { amount: string; currency: string; period?: "year" };
}

export async function checkAvailability(
  domain: string,
): Promise<DomainAvailability> {
  const cfg = registrarConfig();
  if (!cfg.configured) {
    return {
      domain,
      available: null,
      premium: false,
      reason: `registrar not configured (missing: ${cfg.missing.join(", ")})`,
    };
  }
  const r = await cf<CfAvailabilityResponse>(
    `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/registrar/domains/${encodeURIComponent(domain)}/availability`,
  );
  if (!r.ok) {
    return {
      domain,
      available: null,
      premium: false,
      reason: r.error,
    };
  }
  const body = r.result;
  return {
    domain,
    available: body.available,
    premium: Boolean(body.premium),
    price: body.price
      ? { amount: body.price.amount, currency: body.price.currency, period: "year" }
      : undefined,
    renewalPrice: body.renewal_price
      ? {
          amount: body.renewal_price.amount,
          currency: body.renewal_price.currency,
          period: "year",
        }
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Order placement
// ─────────────────────────────────────────────────────────────────────────────

export interface RegistrarContact {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string; // ISO 3166-1 alpha-2
}

export interface DomainOrderRequest {
  domain: string;
  years: number; // 1–10
  auto_renew: boolean;
  whois_privacy: boolean;
  contact: RegistrarContact;
}

export interface DomainOrderResult {
  order_id: string;
  status: "pending" | "completed" | "failed" | "unknown";
  total?: string;
  currency?: string;
  /** True when we actually submitted an order to the registrar. */
  submitted: boolean;
  error?: string;
}

interface CfOrderResponse {
  id?: string;
  status?: string;
  total?: { amount: string; currency: string };
}

export async function purchaseDomain(
  order: DomainOrderRequest,
): Promise<DomainOrderResult> {
  const cfg = registrarConfig();
  if (!cfg.configured) {
    return {
      order_id: "",
      status: "failed",
      submitted: false,
      error: `registrar not configured (missing: ${cfg.missing.join(", ")})`,
    };
  }
  if (!order.years || order.years < 1 || order.years > 10) {
    return { order_id: "", status: "failed", submitted: false, error: "years must be 1–10" };
  }
  const r = await cf<CfOrderResponse>(
    `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/registrar/orders`,
    {
      method: "POST",
      body: JSON.stringify({
        domain: order.domain,
        years: order.years,
        auto_renew: order.auto_renew,
        privacy: order.whois_privacy,
        contact: order.contact,
      }),
    },
  );
  if (!r.ok) {
    return {
      order_id: "",
      status: "failed",
      submitted: false,
      error: r.error,
    };
  }
  const body = r.result;
  const status = (body.status ?? "unknown") as DomainOrderResult["status"];
  return {
    order_id: body.id ?? "",
    status,
    total: body.total?.amount,
    currency: body.total?.currency,
    submitted: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-purchase: provision default DNS records for the new zone.
// This re-uses the existing Cloudflare DNS client (src/lib/cloudflare.ts)
// so the new domain immediately resolves to the panel's tunnel / origin IP.
// ─────────────────────────────────────────────────────────────────────────────

import { upsertCloudflareDnsRecord } from "@/lib/cloudflare";

export interface DnsProvisionResult {
  provisioned: boolean;
  records: Array<{ type: string; name: string; ok: boolean; error?: string }>;
}

/**
 * Provision the bare-minimum DNS records a customer site needs:
 *   @    A      → originIp           (apex, proxied through Cloudflare)
 *   www  CNAME  → apex domain        (proxied)
 *   @    MX     → mx.cloudflare.net  (Cloudflare email routing)
 *   @    TXT    → SPF for Cloudflare email
 *
 * The function is idempotent: upsertCloudflareDnsRecord matches an existing
 * exact record and updates it in place rather than creating a duplicate.
 * Errors per-record are tolerated (e.g. the zone does not exist yet for a
 * brand-new domain); the caller is told which records succeeded.
 */
export async function provisionDefaultDns(
  domain: string,
  originIp: string,
): Promise<DnsProvisionResult> {
  const records: DnsProvisionResult["records"] = [];

  const a = await upsertCloudflareDnsRecord({
    type: "A",
    name: domain,
    content: originIp,
    proxied: true,
  });
  records.push({ type: "A", name: domain, ok: a.success, error: a.error });

  const cname = await upsertCloudflareDnsRecord({
    type: "CNAME",
    name: `www.${domain}`,
    content: domain,
    proxied: true,
  });
  records.push({ type: "CNAME", name: `www.${domain}`, ok: cname.success, error: cname.error });

  const mx = await upsertCloudflareDnsRecord({
    type: "MX",
    name: domain,
    content: "route1.mx.cloudflare.net",
    priority: 10,
  });
  records.push({ type: "MX", name: domain, ok: mx.success, error: mx.error });

  const txt = await upsertCloudflareDnsRecord({
    type: "TXT",
    name: domain,
    content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
  });
  records.push({ type: "TXT", name: domain, ok: txt.success, error: txt.error });

  return { provisioned: records.some((r) => r.ok), records };
}

export const cloudflareRegistrar = {
  registrarConfig,
  checkAvailability,
  purchaseDomain,
  provisionDefaultDns,
};
