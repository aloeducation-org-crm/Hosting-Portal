/**
 * Provider integration registry — one honest status list for every external
 * provider the control plane depends on (Servers C and D plus the optional
 * Cloudflare DNS/SSL adapter).
 *
 * `listProviderStatuses()` is the ONLY source the dashboard uses to render
 * integration state. It never returns `connected: true` unless a live
 * verification has actually been recorded — an unconfigured provider is
 * `blocked` with the exact missing dependency, and a configured-but-never-
 * proven provider is `unverified`.
 */
import { env } from "@/lib/env";
import type { ProviderStatus } from "./types";
import { hostingerAdapter, hostingerStatus } from "./hostinger";
import { cpanelAdapter, cpanelStatus } from "./cpanel";

/** ISO timestamp of a successful live verification, if one has been recorded. */
export type VerifiedAt = string | null;

export interface VerificationRecord {
  hostinger: VerifiedAt;
  cpanel: VerifiedAt;
}

/**
 * Verifications are process-memory only: this build has no provider
 * credentials, so nothing can ever be marked verified here. Persisting a
 * verification belongs with the credentials themselves (Secrets store) and is
 * deliberately not faked in the meantime.
 */
const recordedVerifications: VerificationRecord = { hostinger: null, cpanel: null };

export function recordHostingerVerification(iso: string): void {
  recordedVerifications.hostinger = iso;
}

export function recordCpanelVerification(iso: string): void {
  recordedVerifications.cpanel = iso;
}

function cloudflareStatus(): ProviderStatus {
  const configured = Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID);
  return {
    id: "cloudflare",
    label: "Cloudflare DNS & SSL (optional)",
    purpose: "Alternative DNS provider mode when Cloudflare is chosen over registrar or ALO-managed DNS",
    connected: false,
    state: configured ? "unverified" : "blocked",
    blocker: configured
      ? "Credentials are set but no live verification has been recorded from this control plane."
      : "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID not configured (optional — DNS can also run in registrar or ALO-managed mode).",
    capabilities: ["upsert-dns-record", "delete-dns-record", "read-zone"],
    verifiedAt: null,
  };
}

export function listProviderStatuses(): ProviderStatus[] {
  return [
    hostingerStatus(recordedVerifications.hostinger),
    cpanelStatus(recordedVerifications.cpanel),
    cloudflareStatus(),
  ];
}

export const providerAdapters = [hostingerAdapter, cpanelAdapter];
