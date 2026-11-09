import { NextRequest, NextResponse } from "next/server";
import { TLD_PRICES, tldPrice } from "@/lib/marketing/hosting-catalog";

/**
 * Public domain availability check for the storefront.
 *
 * Availability is answered by the registry's RDAP service, never inferred from
 * DNS: a missing A record says nothing about whether a name is registered. When
 * RDAP cannot be reached (rate limited, offline, unknown TLD) the response says
 * `available: null` and the UI shows "check at checkout" instead of guessing.
 */
export const dynamic = "force-dynamic";

const RDAP_BASE = (process.env.RDAP_BASE_URL ?? "https://rdap.org").replace(/\/$/, "");
const LOOKUP_TIMEOUT_MS = 4_000;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

interface LookupResult {
  domain: string;
  tld: string;
  available: boolean | null;
  price: number | null;
  renewal: number | null;
  currency: "USD";
}

async function rdapAvailability(domain: string): Promise<boolean | null> {
  try {
    const response = await fetch(`${RDAP_BASE}/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: "application/rdap+json" },
      redirect: "follow",
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status === 404) return true;
    // 429/5xx mean "we do not know", not "registered".
    if (response.ok) return false;
    return null;
  } catch {
    return null;
  }
}

function buildCandidates(rawQuery: string): string[] {
  const query = rawQuery.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const dot = query.indexOf(".");
  const base = dot > 0 ? query.slice(0, dot) : query;
  if (!base) return [];

  const candidates: string[] = [];
  const requested = query.includes(".") ? query : `${query}.com`;
  candidates.push(requested);

  for (const entry of TLD_PRICES.filter((item) => item.popular || [".com", ".net", ".org", ".io", ".dev"].includes(item.tld))) {
    const candidate = `${base}${entry.tld}`;
    if (!candidates.includes(candidate) && candidates.length < 5) candidates.push(candidate);
  }
  return candidates;
}

export async function GET(request: NextRequest) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json(
      { ok: false, error: "Enter a domain name to search." },
      { status: 400 },
    );
  }

  const candidates = buildCandidates(query);
  if (candidates.length === 0 || !candidates.every((candidate) => DOMAIN_RE.test(candidate))) {
    return NextResponse.json(
      { ok: false, error: "That does not look like a valid domain. Try something like yourbrand.com." },
      { status: 400 },
    );
  }

  const results: LookupResult[] = await Promise.all(
    candidates.map(async (domain) => {
      const tld = `.${domain.split(".").pop()}`;
      const price = tldPrice(tld);
      return {
        domain,
        tld,
        available: await rdapAvailability(domain),
        price: price?.register ?? null,
        renewal: price?.renewal ?? null,
        currency: "USD" as const,
      };
    }),
  );

  const verified = results.some((result) => result.available !== null);

  return NextResponse.json(
    {
      ok: true,
      verified,
      note: verified
        ? "Availability comes live from the registry. Confirm the final price at checkout."
        : "The registry lookup is unreachable right now, so availability cannot be confirmed. You can still reserve the name and we will confirm it before charging you.",
      results,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
