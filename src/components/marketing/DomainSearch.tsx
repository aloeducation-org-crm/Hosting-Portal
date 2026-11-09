"use client";

import { useRef, useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, Check, Loader2, Search, X } from "lucide-react";
import { formatUsd } from "@/lib/marketing/hosting-catalog";

interface DomainResult {
  domain: string;
  tld: string;
  available: boolean | null;
  price: number | null;
  renewal: number | null;
}

interface SearchPayload {
  ok: boolean;
  verified?: boolean;
  note?: string;
  error?: string;
  results?: DomainResult[];
}

function StatusBadge({ available }: { available: boolean | null }) {
  if (available === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">
        <Check className="size-3" /> Available
      </span>
    );
  }
  if (available === false) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-600">
        <X className="size-3" /> Taken
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
      <AlertCircle className="size-3" /> Confirm at checkout
    </span>
  );
}

export default function DomainSearch({
  variant = "light",
  autoFocus = false,
  initialQuery = "",
}: {
  variant?: "light" | "dark";
  autoFocus?: boolean;
  /** Pre-fills the field (used by /domains?q= deep links). */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<SearchPayload | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dark = variant === "dark";

  async function search(raw: string) {
    const q = raw.trim();
    if (!q) return;

    setLoading(true);
    setPayload(null);
    try {
      const response = await fetch(`/api/marketing/domain-check?q=${encodeURIComponent(q)}`, {
        headers: { accept: "application/json" },
      });
      const data = (await response.json()) as SearchPayload;
      setPayload(
        response.ok
          ? data
          : { ok: false, error: data.error ?? "Domain search failed. Please try again." },
      );
    } catch {
      setPayload({ ok: false, error: "Network error. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    void search(query);
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} role="search" aria-label="Domain name search">
        <div
          className={`flex items-center gap-2 rounded-full p-1.5 shadow-lg ${
            dark ? "bg-white/10 ring-1 ring-white/20" : "bg-white ring-1 ring-slate-200"
          }`}
        >
          <Search className={`ml-3 size-5 shrink-0 ${dark ? "text-white/70" : "text-slate-400"}`} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            autoFocus={autoFocus}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find your next domain, e.g. yourbrand.com"
            aria-label="Domain name"
            autoComplete="off"
            spellCheck={false}
            className={`min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none sm:text-base ${
              dark
                ? "text-white placeholder:text-white/60"
                : "text-[#1E293B] placeholder:text-slate-400"
            }`}
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#E8501A] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#C73D12] disabled:opacity-60 sm:px-6"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            <span className="hidden sm:inline">{loading ? "Checking…" : "Search"}</span>
          </button>
        </div>
      </form>

      <div aria-live="polite" className="mt-3">
        {payload && !payload.ok && (
          <p className="rounded-xl bg-white p-4 text-sm text-red-700 shadow-sm">{payload.error}</p>
        )}

        {payload?.ok && payload.results?.length ? (
          <div className="overflow-hidden rounded-2xl bg-white text-left shadow-xl ring-1 ring-slate-100">
            <ul>
              {payload.results.map((result) => (
                <li
                  key={result.domain}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0 hover:bg-[#FFF7ED]"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="truncate text-sm font-semibold text-[#1E293B]">
                      {result.domain}
                    </span>
                    <StatusBadge available={result.available} />
                  </div>
                  <div className="flex items-center gap-3">
                    {result.price !== null && (
                      <span className="text-sm font-bold text-[#1E293B]">
                        {formatUsd(result.price)}
                        <span className="text-[11px] font-medium text-slate-400">/yr</span>
                      </span>
                    )}
                    <a
                      href={`/register?domain=${encodeURIComponent(result.domain)}`}
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        result.available === false
                          ? "pointer-events-none bg-slate-100 text-slate-400"
                          : "bg-[#E8501A] text-white hover:bg-[#C73D12]"
                      }`}
                      aria-disabled={result.available === false}
                    >
                      {result.available === false ? "Unavailable" : "Continue"}
                      {result.available !== false && <ArrowRight className="size-3" />}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
            {payload.note && (
              <p className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-[11px] leading-relaxed text-[#475569]">
                {payload.note}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
