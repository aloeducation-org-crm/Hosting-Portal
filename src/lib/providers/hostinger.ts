/**
 * Hostinger provider adapter — Server C (public-facing services / external
 * hosting gateway).
 *
 * Auth model (verified against Hostinger's public API reference,
 * https://developers.hostinger.com): API-token authentication via
 * `Authorization: Bearer <token>` on `https://developers.hostinger.com/...`.
 *
 * Honest-state contract: this control plane has no HOSTINGER_API_TOKEN and no
 * outbound path to developers.hostinger.com from the test environment, so the
 * adapter starts `blocked`. Presenting a token moves it to `unverified` — it
 * only becomes `connected` after `verifyAccess()` performs a real HTTP round
 * trip and the caller records the result. Nothing here fabricates inventory.
 */
import { env } from "@/lib/env";
import type { ProviderAdapter, ProviderStatus } from "./types";
import { redactSecret } from "./types";

export const HOSTINGER_API_BASE = "https://developers.hostinger.com";

/**
 * Access-check endpoint: list the account's virtual machines.
 * Path grounded in Hostinger's VPS API reference (`/api/vps/v1/...`).
 */
export const HOSTINGER_VERIFY_PATH = "/api/vps/v1/virtual-machines";

export function isHostingerConfigured(): boolean {
  return Boolean(env.HOSTINGER_API_TOKEN);
}

export function hostingerStatus(verifiedAt: string | null = null): ProviderStatus {
  const configured = isHostingerConfigured();
  const connected = configured && verifiedAt !== null;
  return {
    id: "hostinger",
    label: "Hostinger (Server C)",
    purpose:
      "Public-facing services, external hosting gateway, central dashboard hosting, encrypted offsite backup target",
    connected,
    state: connected ? "connected" : configured ? "unverified" : "blocked",
    blocker: connected
      ? null
      : configured
        ? "HOSTINGER_API_TOKEN is set but no live API verification has ever succeeded. Run the access check once outbound access to developers.hostinger.com is available."
        : "HOSTINGER_API_TOKEN is not configured (Server C credential missing).",
    capabilities: [
      "list-virtual-machines",
      "read-vps-status",
      "attach-ssh-keys",
      "power-actions",
    ],
    verifiedAt: connected ? verifiedAt : null,
  };
}

export interface HostingerAccessResult {
  ok: boolean;
  /** Machine-readable failure class when not ok. */
  reason?: "NOT_CONFIGURED" | "HTTP_ERROR" | "NETWORK_ERROR";
  /** Safe-to-display message — token is always redacted. */
  message: string;
  /** Number of virtual machines actually returned by the API. */
  virtualMachineCount?: number;
  checkedAt?: string;
}

/**
 * Real access check. Never throws, never invents a count: any failure comes
 * back as `{ ok: false, reason, message }` with the token redacted.
 */
export async function verifyHostingerAccess(
  opts: { token?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<HostingerAccessResult> {
  const token = opts.token ?? env.HOSTINGER_API_TOKEN;
  if (!token) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      message: "HOSTINGER_API_TOKEN is not configured (Server C credential missing).",
    };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await doFetch(`${HOSTINGER_API_BASE}${HOSTINGER_VERIFY_PATH}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: "HTTP_ERROR",
        message: redactSecret(
          `Hostinger API responded ${res.status} ${res.statusText}`.slice(0, 200),
          token
        ),
      };
    }
    const json = (await res.json().catch(() => null)) as
      | { data?: unknown[] }
      | null;
    const count = Array.isArray(json?.data) ? json.data.length : 0;
    return {
      ok: true,
      message: `Hostinger API reachable; ${count} virtual machine(s) reported.`,
      virtualMachineCount: count,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "NETWORK_ERROR",
      message: redactSecret(`Hostinger API unreachable: ${raw}`.slice(0, 200), token),
    };
  }
}

export const hostingerAdapter: ProviderAdapter = {
  id: "hostinger",
  label: "Hostinger (Server C)",
  purpose:
    "Public-facing services, external hosting gateway, central dashboard hosting, encrypted offsite backup target",
  capabilities: ["list-virtual-machines", "read-vps-status", "attach-ssh-keys", "power-actions"],
  status: () => hostingerStatus(),
};
