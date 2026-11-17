"use client";

/**
 * Free for Dev center — browsable directory of free-tier developer services.
 *
 * Every row comes from GET /api/free-for-dev (the curated catalog synced from
 * the community free-for.dev list); this component renders only what the API
 * returns and filters that data client-side for instant search.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Gift,
  Loader2,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface FreeService {
  id: string;
  name: string;
  url: string;
  summary: string;
  details: string[];
  categoryId: string;
  categoryLabel: string;
}

interface CategorySummary {
  id: string;
  label: string;
  anchor: string;
  count: number;
}

interface CatalogSource {
  name: string;
  listUrl: string;
  repoUrl: string;
  commit: string | null;
  syncedAt: string;
  attribution: string;
}

interface CatalogData {
  source: CatalogSource;
  categories: CategorySummary[];
  total: number;
  services: FreeService[];
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function FreeForDevCenter() {
  const [data, setData] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/free-for-dev", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.message ?? `catalog endpoint returned ${res.status}`);
      }
      setData(body.data as CatalogData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the Free for Dev catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!cancelled) await load();
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const visible = useMemo(() => {
    const rows = data?.services ?? [];
    const needle = query.trim().toLowerCase();
    return rows.filter((s) => {
      if (category && s.categoryId !== category) return false;
      if (!needle) return true;
      const haystack = `${s.name}\n${s.summary}\n${s.details.join("\n")}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [data, query, category]);

  const toggleDetails = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-purple-600">
            <Gift className="h-3.5 w-3.5" />
            Free resources
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Free for Dev</h1>
          <p className="text-sm text-slate-500">
            A directory of free-tier developer services — DNS, CDN, hosting, databases, email, monitoring and
            more — curated from the community free-for.dev list. Free tiers change often: verify the current
            limits with the provider before you rely on them.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-4 w-4 text-[#E8501A]" />
            Browse the catalog
            {data?.source?.syncedAt && (
              <Badge className="ml-2 bg-emerald-100 text-emerald-800">synced {data.source.syncedAt}</Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            {data
              ? `Showing ${visible.length} of ${data.total} services across ${data.categories.length} categories`
              : "Loading services…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search services, limits or features…"
              className="pl-9"
              aria-label="Search the Free for Dev catalog"
            />
          </div>

          {data && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setCategory("")}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  category === ""
                    ? "bg-[#E8501A] text-white border-[#E8501A]"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                }`}
              >
                All ({data.total})
              </button>
              {data.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id === category ? "" : c.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    category === c.id
                      ? "bg-[#E8501A] text-white border-[#E8501A]"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {c.label} ({c.count})
                </button>
              ))}
            </div>
          )}

          {loading && !data && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading services…
            </div>
          )}

          {!loading && !error && data && visible.length === 0 && (
            <div className="text-sm text-slate-500 py-8 text-center">
              No services match “{query}”. Try a different word or clear the category filter.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((service) => {
              const isOpen = expanded.has(service.id);
              const blurb = service.summary || service.details[0] || "";
              return (
                <Card key={service.id} className="border-slate-200 flex flex-col">
                  <CardContent className="p-4 flex flex-col gap-2 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      {isWebUrl(service.url) ? (
                        <a
                          href={service.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-sm text-slate-900 hover:text-[#E8501A] flex items-center gap-1"
                        >
                          {service.name}
                          <ExternalLink className="h-3 w-3 text-slate-400" />
                        </a>
                      ) : (
                        <span className="font-semibold text-sm text-slate-900">{service.name}</span>
                      )}
                      <Badge className="bg-slate-100 text-slate-600 border-slate-200 shrink-0 text-[10px]">
                        {service.categoryLabel}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {blurb || "Free tier details on the provider site."}
                    </p>
                    {service.details.length > 0 && (
                      <div className="mt-auto pt-1">
                        <button
                          type="button"
                          onClick={() => toggleDetails(service.id)}
                          className="text-xs text-[#E8501A] font-medium hover:underline"
                        >
                          {isOpen ? "Hide details" : `Free-tier details (${service.details.length})`}
                        </button>
                        {isOpen && (
                          <ul className="mt-2 space-y-1 text-xs text-slate-500 list-disc pl-4">
                            {service.details.map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {data?.source && (
        <Card className="border-slate-200">
          <CardContent className="p-4 text-xs text-slate-500 space-y-1">
            <p>{data.source.attribution}</p>
            <p>
              Source:{" "}
              <a
                href={data.source.listUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#E8501A] hover:underline"
              >
                {data.source.name}
              </a>{" "}
              ·{" "}
              <a
                href={data.source.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#E8501A] hover:underline"
              >
                {data.source.repoUrl.replace("https://", "")}
              </a>
              {data.source.commit ? ` · synced from commit ${data.source.commit.slice(0, 12)}` : ""}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
