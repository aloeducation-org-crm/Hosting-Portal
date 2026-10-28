/**
 * Provider adapter contracts for the four-server control plane.
 *
 * Server A and B are managed by the enrolled ALO agent (no provider API).
 * This module covers the two *provider-managed* hosts:
 *
 *   - Server C — Hostinger (public API, token-scoped)
 *   - Server D — cPanel shared hosting (UAPI, token-scoped)
 *
 * Rules every adapter must obey:
 *   1. Never claim `connected` without a live, verified API round-trip.
 *      Until an operator runs a real check, the state is `blocked` (missing
 *      credential) or `unverified` (credential present, never proven).
 *   2. The `blocker` always names the exact missing dependency.
 *   3. Credentials never appear in status output, logs or error strings.
 *   4. No simulated success: an adapter without its credential refuses the
 *      operation with an explicit reason instead of inventing data.
 */

export type ProviderId = "hostinger" | "cpanel" | "cloudflare";

export type ProviderState = "blocked" | "unverified" | "connected";

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  /** What this provider is responsible for in the four-server architecture. */
  purpose: string;
  /** True only after a real live API check succeeded and was recorded. */
  connected: boolean;
  state: ProviderState;
  /** Exact missing dependency or next step. null when connected. */
  blocker: string | null;
  /** Operations the adapter supports once configured and verified. */
  capabilities: string[];
  /** ISO timestamp of the last successful live verification, null = never. */
  verifiedAt: string | null;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  purpose: string;
  capabilities: string[];
  status(): ProviderStatus;
}

/** Redacts a secret from any string that may leave the adapter. */
export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}
