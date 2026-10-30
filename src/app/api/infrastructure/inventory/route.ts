import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import { resolveInventory, inventoryEvidenceSummary } from "@/lib/infrastructure/server-inventory";
import { describeFact } from "@/lib/infrastructure/inventory";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/**
 * Declared four-server inventory, with per-fact evidence.
 *
 * This is deliberately a **separate endpoint from `/api/infrastructure/topology`**
 * because the two answer different questions and neither can answer the other:
 *
 *   topology   — "what has this control plane actually observed?"  (DB rows:
 *                registered servers, enrolled agents, their last heartbeats)
 *   inventory  — "what are the four servers we are *supposed* to manage, and how
 *                much of that is evidenced?"  (declared registry; mostly lead
 *                data today, because no host is reachable)
 *
 * Collapsing them would make an unreachable server vanish from the inventory the
 * moment it stopped reporting, which is precisely the failure mode the brief
 * warns about: an unreachable host must not look like an absent one.
 *
 * Invariants upheld here:
 *   - No writes. A GET never creates or mutates a record.
 *   - Every value carries `source` and `observedAt`; anything undatable is nulled
 *     by `resolveInventory` before it reaches the wire.
 *   - `describeFact` output is included so a consumer cannot render a value
 *     without its provenance by accident.
 *   - Nothing here can report `VERIFIED` while no host has been observed.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);

    const now = new Date();
    const entries = resolveInventory(now);

    const servers = entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      serverClass: entry.serverClass,
      hostname: entry.hostname,
      hostnameDisplay: describeFact(entry.hostname, now),
      provider: entry.provider,
      providerDisplay: describeFact(entry.provider, now),
      connection: {
        method: entry.connection.method,
        demonstrated: entry.connection.demonstrated,
        endpoint: entry.connection.endpoint,
        endpointDisplay: describeFact(entry.connection.endpoint, now),
        note: entry.connection.note,
      },
      facts: Object.fromEntries(
        Object.entries(entry.facts).map(([key, fact]) => [
          key,
          { fact, display: describeFact(fact, now) },
        ]),
      ),
      blockedBy: entry.blockedBy,
    }));

    return NextResponse.json(
      apiSuccess({
        collectedAt: now.toISOString(),
        // The single most important number on this response: how many facts in
        // the registry are actually verified. Today it is zero, by construction.
        evidenceSummary: inventoryEvidenceSummary(entries),
        serversConnected: entries.filter((e) => e.connection.demonstrated).length,
        servers,
        caveat:
          "Every fact here carries its own evidence source and observation time. Nothing in this registry has been verified against a host, because no host is reachable from the control plane. Treat owner-provided values as leads, not measurements.",
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
