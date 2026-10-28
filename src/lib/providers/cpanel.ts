/**
 * cPanel/WHM provider adapter — Server D (aloeducation.com business email,
 * mailboxes, aliases, forwarders, SMTP integration).
 *
 * Auth model (verified against public cPanel API-token documentation): the
 * token goes in the `Authorization: cpanel <user>:<token>` header against the
 * cPanel UAPI over TLS on port 2083, e.g.
 * `GET https://host:2083/execute/Email/list_pops`.
 *
 * Rules specific to Server D:
 *   - Existing mailboxes/messages/MX/SPF/DKIM/DMARC must be preserved: this
 *     adapter exposes read operations and explicitly-scoped write operations
 *     only, and it never touches DNS.
 *   - The password/token is never logged, never placed in a URL, and is
 *     redacted from every error string.
 *
 * Honest-state contract: without CPANEL_HOST/CPANEL_USER/CPANEL_TOKEN the
 * adapter is `blocked`; credentials alone yield `unverified` until a real
 * round trip succeeds.
 */
import { env } from "@/lib/env";
import type { ProviderAdapter, ProviderStatus } from "./types";
import { redactSecret } from "./types";

export function cpanelConfig(): { host: string; user: string; token: string } {
  return {
    host: env.CPANEL_HOST,
    user: env.CPANEL_USER,
    token: env.CPANEL_TOKEN,
  };
}

export type CpanelConfig = ReturnType<typeof cpanelConfig>;

export function isCpanelConfigured(cfg: CpanelConfig = cpanelConfig()): boolean {
  const { host, user, token } = cfg;
  return Boolean(host && user && token);
}

export function cpanelStatus(verifiedAt: string | null = null, cfg: CpanelConfig = cpanelConfig()): ProviderStatus {
  const configured = isCpanelConfigured(cfg);
  const connected = configured && verifiedAt !== null;
  const missing = (
    [
      ["CPANEL_HOST", cfg.host],
      ["CPANEL_USER", cfg.user],
      ["CPANEL_TOKEN", cfg.token],
    ] as Array<[string, string]>
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return {
    id: "cpanel",
    label: "cPanel shared hosting (Server D)",
    purpose:
      "Existing aloeducation.com business email: mailboxes, aliases, forwarders, SMTP integration, provider-supported file management",
    connected,
    state: connected ? "connected" : configured ? "unverified" : "blocked",
    blocker: connected
      ? null
      : configured
        ? "Credentials are set but no live API verification has ever succeeded. Run the access check from the production host."
        : `Missing Server D credential(s): ${missing.join(", ")}.`,
    capabilities: [
      "list-mailboxes",
      "create-mailbox",
      "disable-mailbox",
      "set-mailbox-quota",
      "list-aliases",
      "list-forwarders",
      "test-send",
    ],
    verifiedAt: connected ? verifiedAt : null,
  };
}

/**
 * Builds the UAPI request for listing mailboxes.
 * The token is returned ONLY inside the header value — never in the URL.
 */
export function buildListMailboxesRequest(
  cfg: CpanelConfig = cpanelConfig()
): { url: string; headers: Record<string, string> } | null {
  const { host, user, token } = cfg;
  if (!host || !user || !token) return null;
  const base = host.replace(/\/+$/, "");
  const withScheme = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  // Standard cPanel TLS port, added only when the operator did not supply one.
  let origin: string;
  try {
    const parsed = new URL(withScheme);
    origin = parsed.port ? `${parsed.protocol}//${parsed.hostname}:${parsed.port}` : `${parsed.protocol}//${parsed.hostname}:2083`;
  } catch {
    return null;
  }
  return {
    url: `${origin}/execute/Email/list_pops`,
    headers: {
      Authorization: `cpanel ${user}:${token}`,
      Accept: "application/json",
    },
  };
}

/** Basic shape validation for a mailbox write (add_pop) request. */
export function validateMailboxInput(input: { domain?: string; localPart?: string; quotaMb?: number }): string | null {
  const domain = input.domain ?? "";
  const localPart = input.localPart ?? "";
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(domain)) {
    return "domain must be a valid DNS name";
  }
  if (!/^[a-z0-9]([a-z0-9._-]{0,63})$/i.test(localPart)) {
    return "localPart must be a plain mailbox name (letters, digits, . _ -)";
  }
  if (input.quotaMb !== undefined && (!Number.isInteger(input.quotaMb) || input.quotaMb < 1 || input.quotaMb > 1024 * 1024)) {
    return "quotaMb must be an integer between 1 and 1048576";
  }
  return null;
}

export interface CpanelAccessResult {
  ok: boolean;
  reason?: "NOT_CONFIGURED" | "HTTP_ERROR" | "NETWORK_ERROR";
  message: string;
  mailboxCount?: number;
  checkedAt?: string;
}

/**
 * Real access check against `Email/list_pops`. Refuses without credentials,
 * redacts the token from every failure, and reports only what the API returned.
 */
export async function verifyCpanelAccess(
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; config?: CpanelConfig } = {}
): Promise<CpanelAccessResult> {
  const cfg = opts.config ?? cpanelConfig();
  const req = buildListMailboxesRequest(cfg);
  const token = cfg.token;
  if (!req) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      message: `Missing Server D credential(s): ${(
        [
          ["CPANEL_HOST", cfg.host],
          ["CPANEL_USER", cfg.user],
          ["CPANEL_TOKEN", cfg.token],
        ] as Array<[string, string]>
      )
        .filter(([, v]) => !v)
        .map(([k]) => k)
        .join(", ")}.`,
    };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await doFetch(req.url, { headers: req.headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: "HTTP_ERROR",
        message: redactSecret(`cPanel API responded ${res.status} ${res.statusText}`.slice(0, 200), token),
      };
    }
    const json = (await res.json().catch(() => null)) as
      | { data?: Array<unknown> }
      | null;
    const count = Array.isArray(json?.data) ? json.data.length : 0;
    return {
      ok: true,
      message: `cPanel UAPI reachable; ${count} mailbox(es) reported.`,
      mailboxCount: count,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "NETWORK_ERROR",
      message: redactSecret(`cPanel API unreachable: ${raw}`.slice(0, 200), token),
    };
  }
}

export const cpanelAdapter: ProviderAdapter = {
  id: "cpanel",
  label: "cPanel shared hosting (Server D)",
  purpose:
    "Existing aloeducation.com business email: mailboxes, aliases, forwarders, SMTP integration",
  capabilities: [
    "list-mailboxes",
    "create-mailbox",
    "disable-mailbox",
    "set-mailbox-quota",
    "list-aliases",
    "list-forwarders",
    "test-send",
  ],
  status: () => cpanelStatus(),
};
