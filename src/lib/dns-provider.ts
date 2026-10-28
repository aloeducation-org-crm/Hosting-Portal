/**
 * §8 provider-independent DNS — mode selection, honest publication state and
 * the publish gate used by every DNS mutation.
 *
 * Modes:
 *   local     — panel zone store only (the historical behaviour). Records are
 *               real database rows but are NEVER pushed to an authoritative
 *               nameserver, and every response says so.
 *   cloudflare — executes through the existing Cloudflare adapter; an
 *               unconfigured token blocks writes instead of simulating them.
 *   powerdns  — ALO-managed authoritative engine: blocked until a PowerDNS
 *               API endpoint + key are configured (none exists today).
 *   registrar  — registrar API mode: blocked until registrar credentials are
 *               configured (none exists today).
 *
 * The mode is read from `DNS_PROVIDER_MODE` at call time (defaults to
 * `local`) so operators and tests can switch it without a rebuild. An unknown
 * value falls back to `local` — the safe, non-executing mode.
 */
import { env } from "@/lib/env";
import { upsertCloudflareDnsRecord } from "@/lib/cloudflare";

export const DNS_MODES = ["local", "cloudflare", "powerdns", "registrar"] as const;
export type DnsMode = (typeof DNS_MODES)[number];

export function currentDnsMode(): DnsMode {
  const raw = (process.env.DNS_PROVIDER_MODE ?? "").trim().toLowerCase();
  return (DNS_MODES as readonly string[]).includes(raw) ? (raw as DnsMode) : "local";
}

export interface DnsPublicationState {
  mode: DnsMode;
  /** True only for modes that actually talk to an external DNS system. */
  executes: boolean;
  /** "active" = verified live · "unverified" = creds but no live proof · "blocked" · "panel-only" */
  state: "active" | "unverified" | "blocked" | "panel-only";
  blocker: string | null;
  /** How records in this mode are handled, for the dashboard. */
  behavior: string;
}

/** Last successful live publish, process-scoped (never claimed without a call). */
let lastLivePublishAt: string | null = null;
export function lastDnsLivePublishAt(): string | null {
  return lastLivePublishAt;
}

const LOCAL_BLOCKER =
  "Panel zone store only: DNS rows are kept in the platform database and are NOT published to any authoritative nameserver. Set DNS_PROVIDER_MODE to a provider mode (cloudflare, registrar, or powerdns) with its credentials to execute changes externally.";
const CLOUDFLARE_BLOCKED =
  "Cloudflare mode selected but CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID are not configured.";
const POWERDNS_BLOCKED =
  "PowerDNS mode selected but no ALO-managed authoritative DNS engine is configured (POWERDNS_API_URL / POWERDNS_API_KEY are unset). No PowerDNS installation has been enrolled.";
const REGISTRAR_BLOCKED =
  "Registrar mode selected but no registrar API credentials are configured (REGISTRAR_API_TOKEN unset). Nameserver-side changes require registrar authorization.";

export function dnsPublicationState(mode: DnsMode = currentDnsMode()): DnsPublicationState {
  if (mode === "local") {
    return {
      mode,
      executes: false,
      state: "panel-only",
      blocker: LOCAL_BLOCKER,
      behavior: "Records are stored and edited in the panel only; the dashboard reports them as unpublished.",
    };
  }
  if (mode === "cloudflare") {
    const configured = Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID);
    if (!configured) {
      return {
        mode,
        executes: true,
        state: "blocked",
        blocker: CLOUDFLARE_BLOCKED,
        behavior: "DNS mutations are refused until the credentials exist — nothing is simulated.",
      };
    }
    return {
      mode,
      executes: true,
      state: lastLivePublishAt ? "active" : "unverified",
      blocker: lastLivePublishAt
        ? null
        : "Credentials are set but no publish has succeeded from this control plane yet.",
      behavior: "Mutations publish to the Cloudflare zone API; failures are returned as errors, not ignored.",
    };
  }
  if (mode === "powerdns") {
    return {
      mode,
      executes: true,
      state: "blocked",
      blocker: POWERDNS_BLOCKED,
      behavior: "DNS mutations are refused until an authoritative engine is enrolled.",
    };
  }
  return {
    mode,
    executes: true,
    state: "blocked",
    blocker: REGISTRAR_BLOCKED,
    behavior: "DNS mutations are refused until registrar credentials are configured and authorized.",
  };
}

export interface PublishInput {
  type: string;
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
}

export interface PublishResult {
  ok: boolean;
  /** Whether an external system was actually changed. */
  executed: boolean;
  code?: string;
  note: string;
  providerRecordId?: string;
}

/**
 * Publish gate for a DNS mutation. Call BEFORE persisting: a mode that should
 * execute but cannot must refuse the write outright, so the panel never holds
 * a "record" that silently went nowhere under an executing mode.
 */
export async function publishDnsRecord(input: PublishInput, mode: DnsMode = currentDnsMode()): Promise<PublishResult> {
  if (mode === "local") {
    return {
      ok: true,
      executed: false,
      note: LOCAL_BLOCKER,
    };
  }
  const state = dnsPublicationState(mode);
  if (state.state === "blocked") {
    return { ok: false, executed: false, code: "DNS_PROVIDER_BLOCKED", note: state.blocker ?? "DNS provider blocked" };
  }

  // cloudflare with credentials — a real API call.
  const res = await upsertCloudflareDnsRecord({
    type: input.type as "A" | "AAAA" | "CNAME" | "TXT" | "MX",
    name: input.name,
    content: input.value,
    ttl: input.ttl,
    priority: input.priority,
    proxied: false,
  });
  if (res.simulated || !res.success) {
    return {
      ok: false,
      executed: false,
      code: "DNS_PUBLISH_FAILED",
      note: res.error
        ? `Cloudflare publish failed: ${String(res.error).slice(0, 200)}`
        : "Cloudflare publish did not confirm success (simulated responses are never treated as success).",
    };
  }
  lastLivePublishAt = new Date().toISOString();
  const id = (res.data as { id?: string } | undefined)?.id;
  return {
    ok: true,
    executed: true,
    note: `Published to Cloudflare at ${lastLivePublishAt}.`,
    ...(id ? { providerRecordId: id } : {}),
  };
}

/**
 * Deletion gate. Local mode deletes from the panel store only. Executing
 * modes refuse: the panel does not store provider record IDs, so claiming an
 * external delete would be a lie.
 */
export function deleteDnsGate(mode: DnsMode = currentDnsMode()): PublishResult {
  if (mode === "local") {
    return { ok: true, executed: false, note: LOCAL_BLOCKER };
  }
  const state = dnsPublicationState(mode);
  return {
    ok: false,
    executed: false,
    code: "DNS_PROVIDER_BLOCKED",
    note:
      state.blocker ??
      `Deletion while mode="${mode}" is refused: provider record IDs are not stored, so an external delete cannot be performed or verified.`,
  };
}
