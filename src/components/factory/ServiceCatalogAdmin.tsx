"use client";

import * as React from "react";
import { useAuthStore } from "@/stores/authStore";
import {
  Search,
  Plus,
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  Package,
  BadgeDollarSign,
} from "lucide-react";

type IndustryOption = { slug: string; name: string };

type ServiceRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  categoryLabel: string;
  summary: string;
  priceMode: string;
  version: string;
  status: string;
  deliverableCount: number;
  requiredApps: unknown;
  industries: Array<{ slug: string; name: string; relation: string }>;
};

type Detail = ServiceRow & {
  description: string;
  deliverables: unknown;
  prerequisites: unknown;
  exclusions: unknown;
};

const STATUS_STYLES: Record<string, string> = {
  published: "bg-emerald-100 text-emerald-800 border-emerald-200",
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  retired: "bg-red-100 text-red-700 border-red-200",
};

const RELATION_STYLES: Record<string, string> = {
  core: "bg-indigo-100 text-indigo-700",
  recommended: "bg-sky-100 text-sky-700",
  optional: "bg-slate-100 text-slate-600",
};

function zodList(issues?: Array<{ path: string; message: string }>) {
  return (issues ?? []).map((i, n) => `${n + 1}. ${i.path || "(root)"}: ${i.message}`);
}

export default function ServiceCatalogAdmin() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [rows, setRows] = React.useState<ServiceRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState<string>("all");
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/services", { credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load services");
      setRows(json.data.services);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load services");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // queueMicrotask mirrors the repo-approved CrmDialog pattern: state
    // updates must not run synchronously inside the effect body.
    queueMicrotask(() => {
      if (isAuthenticated && user) void load();
    });
  }, [isAuthenticated, user, load]);

  const toggleStatus = async (row: ServiceRow) => {
    const next = row.status === "published" ? "retired" : "published";
    setBusy(row.id);
    try {
      const res = await fetch(`/api/services/${row.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Update failed");
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const openDetail = async (id: string) => {
    setDetail(null);
    try {
      const res = await fetch(`/api/services/${id}`, { credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load");
      setDetail(json.data.service);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  };

  const categories = React.useMemo(() => {
    const set = new Map<string, string>();
    for (const r of rows) set.set(r.category, r.categoryLabel);
    return [...set.entries()];
  }, [rows]);

  const filtered = rows.filter(
    (r) =>
      (category === "all" || r.category === category) &&
      (!search.trim() ||
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.slug.includes(search.toLowerCase()))
  );

  if (!isAuthenticated || !user) {
    return <div className="p-8 text-sm text-slate-500">Sign in as an administrator to manage the catalog.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Package className="h-6 w-6 text-indigo-600" /> Service Catalog
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {rows.length} services · pricing is quotation-based (no prices are stored) · public view at{" "}
            <a className="text-indigo-600 underline" href="/services">
              /services
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search services…"
              className="h-9 w-52 rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> New service
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          <button className="ml-auto text-red-400 hover:text-red-600" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setCategory("all")}
          className={`rounded-full border px-3 py-1 text-xs ${category === "all" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"}`}
        >
          All
        </button>
        {categories.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setCategory(id)}
            className={`rounded-full border px-3 py-1 text-xs ${category === id ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading catalog…
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => (
            <div key={r.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-900">{r.name}</div>
                  <div className="text-[11px] text-slate-400">/{r.slug} · v{r.version}</div>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}
                >
                  {r.status}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-slate-500">{r.summary}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {r.categoryLabel}
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  <BadgeDollarSign className="h-3 w-3" /> quotation
                </span>
                {r.industries.slice(0, 3).map((ind) => (
                  <span
                    key={ind.slug}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${RELATION_STYLES[ind.relation] ?? RELATION_STYLES.optional}`}
                  >
                    {ind.name}
                  </span>
                ))}
                {r.industries.length > 3 && (
                  <span className="text-[10px] text-slate-400">+{r.industries.length - 3} more</span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-1.5 pt-1">
                <button
                  onClick={() => void openDetail(r.id)}
                  className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                >
                  Details
                </button>
                <button
                  disabled={busy === r.id}
                  onClick={() => void toggleStatus(r)}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  {r.status === "published" ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {r.status === "published" ? "Retire" : "Publish"}
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
              No services match.
            </div>
          )}
        </div>
      )}

      {detail && <DetailDialog detail={detail} onClose={() => setDetail(null)} />}
      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setLoading(true);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DetailDialog({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const deliverables = Array.isArray(detail.deliverables)
    ? (detail.deliverables as Array<Record<string, unknown>>)
    : [];
  const prerequisites = Array.isArray(detail.prerequisites) ? (detail.prerequisites as string[]) : [];
  const exclusions = Array.isArray(detail.exclusions) ? (detail.exclusions as string[]) : [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{detail.name}</h2>
            <p className="text-sm text-slate-500">{detail.summary}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-600">{detail.description}</p>

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Deliverables</h3>
        <ul className="mb-4 space-y-1.5">
          {deliverables.map((d, i) => (
            <li key={i} className="rounded border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <span className="font-medium text-slate-800">{String(d.name ?? "")}</span>
              {typeof d.description === "string" && <div className="text-xs text-slate-500">{d.description}</div>}
            </li>
          ))}
        </ul>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Prerequisites</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
              {prerequisites.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
              {prerequisites.length === 0 && <li className="text-slate-400">None</li>}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Exclusions (honest boundaries)
            </h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
              {exclusions.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
              {exclusions.length === 0 && <li className="text-slate-400">None listed</li>}
            </ul>
          </div>
        </div>

        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Industry mapping</h3>
          <div className="flex flex-wrap gap-1.5">
            {detail.industries.map((ind) => (
              <span
                key={ind.slug}
                className={`rounded px-2 py-0.5 text-xs font-medium ${RELATION_STYLES[ind.relation] ?? RELATION_STYLES.optional}`}
              >
                {ind.name} · {ind.relation}
              </span>
            ))}
            {detail.industries.length === 0 && <span className="text-xs text-slate-400">Not mapped yet</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

const NEW_SERVICE_PRESET = `{
  "deliverables": [
    { "name": "Discovery workshop", "description": "Requirements and success criteria." },
    { "name": "Implementation", "description": "Configuration and build per approved scope." },
    { "name": "Handover", "description": "Documentation and training session." }
  ],
  "prerequisites": ["Named client stakeholder"],
  "exclusions": ["Features outside the approved scope"],
  "requiredApps": []
}`;

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [category, setCategory] = React.useState("software");
  const [summary, setSummary] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [content, setContent] = React.useState(NEW_SERVICE_PRESET);
  const [industries, setIndustries] = React.useState<IndustryOption[]>([]);
  const [selected, setSelected] = React.useState<Array<{ industry: string; relation: string }>>([]);
  const [error, setError] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/industries", { credentials: "same-origin" });
        const json = await res.json();
        if (res.ok) setIndustries(json.data.industries as IndustryOption[]);
      } catch {
        /* mapping select stays empty; API still validates */
      }
    })();
  }, []);

  const toggleIndustry = (indSlug: string) => {
    setSelected((prev) => {
      const has = prev.some((p) => p.industry === indSlug);
      if (has) return prev.filter((p) => p.industry !== indSlug);
      return [...prev, { industry: indSlug, relation: "recommended" }];
    });
  };

  const setRelation = (indSlug: string, relation: string) => {
    setSelected((prev) => prev.map((p) => (p.industry === indSlug ? { ...p, relation } : p)));
  };

  const submit = async () => {
    setError([]);
    setBusy(true);
    try {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content) as Record<string, unknown>;
      } catch {
        setError(["content: invalid JSON"]);
        return;
      }
      const res = await fetch("/api/services", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name,
          category,
          summary,
          description,
          status: "draft",
          industries: selected,
          ...parsed,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          json?.error?.details?.issues
            ? zodList(json.error.details.issues)
            : [json?.error?.message ?? "Create failed"]
        );
        return;
      }
      onCreated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Add service to catalog</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        {error.length > 0 && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        )}
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Service name"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="slug (e.g. seo-audit)"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="software">Software & Digital</option>
              <option value="marketing">Digital Marketing</option>
              <option value="seo">SEO Marketing</option>
              <option value="email">Email Marketing</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="social">Social Media</option>
              <option value="analytics">Analytics & Reporting</option>
            </select>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Public summary"
              className="rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Full description"
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs"
          />
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Industry mapping (§9)
            </div>
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-slate-200 p-2">
              {industries.map((ind) => {
                const hit = selected.find((s) => s.industry === ind.slug);
                return (
                  <div key={ind.slug} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!hit}
                      onChange={() => toggleIndustry(ind.slug)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="flex-1 text-slate-700">{ind.name}</span>
                    {hit && (
                      <select
                        value={hit.relation}
                        onChange={(e) => setRelation(ind.slug, e.target.value)}
                        className="rounded border border-slate-200 px-1 py-0.5 text-xs"
                      >
                        <option value="core">core</option>
                        <option value="recommended">recommended</option>
                        <option value="optional">optional</option>
                      </select>
                    )}
                  </div>
                );
              })}
              {industries.length === 0 && (
                <div className="text-xs text-slate-400">Industry list unavailable — mapping can be set later.</div>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Pricing note: services never store prices — quotations are prepared per engagement.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
            Cancel
          </button>
          <button
            disabled={busy || !name || !slug || !summary || !description}
            onClick={() => void submit()}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create as draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
