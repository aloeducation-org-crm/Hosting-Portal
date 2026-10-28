"use client";

import * as React from "react";
import { useAuthStore } from "@/stores/authStore";
import {
  Search,
  Plus,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  Boxes,
} from "lucide-react";

type IndustryRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  summary: string;
  icon: string;
  order: number;
  status: string;
  moduleCount: number;
  featureGroups: number;
  serviceMappings: number;
};

type Detail = IndustryRow & { modules: unknown; features: unknown; faqs: unknown; workflow: unknown };

const STATUS_STYLES: Record<string, string> = {
  published: "bg-emerald-100 text-emerald-800 border-emerald-200",
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  hidden: "bg-amber-100 text-amber-800 border-amber-200",
};

function zodList(issues?: Array<{ path: string; message: string }>) {
  return (issues ?? []).map((i, n) => `${n + 1}. ${i.path || "(root)"}: ${i.message}`);
}

export default function IndustryRegistry() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [rows, setRows] = React.useState<IndustryRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/industries", { credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load industries");
      setRows(json.data.industries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load industries");
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

  const toggleStatus = async (row: IndustryRow) => {
    const next = row.status === "published" ? "hidden" : "published";
    setBusy(row.id);
    try {
      const res = await fetch(`/api/industries/${row.id}`, {
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
      const res = await fetch(`/api/industries/${id}`, { credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load");
      setDetail(json.data.industry);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  };

  const filtered = rows.filter(
    (r) =>
      !search.trim() ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.slug.includes(search.toLowerCase())
  );

  if (!isAuthenticated || !user) {
    return <div className="p-8 text-sm text-slate-500">Sign in as an administrator to manage the registry.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Boxes className="h-6 w-6 text-indigo-600" /> Industry System Registry
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {rows.length} industry families · {rows.reduce((n, r) => n + r.serviceMappings, 0)} service mappings ·
            public directory at <a className="text-indigo-600 underline" href="/industries">/industries</a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search industries…"
              className="h-9 w-56 rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> New industry
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

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading registry…
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Industry</th>
                <th className="px-4 py-3">Modules</th>
                <th className="px-4 py-3">Feature groups</th>
                <th className="px-4 py-3">Services</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{r.name}</div>
                    <div className="text-xs text-slate-500">/industries/{r.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.moduleCount}</td>
                  <td className="px-4 py-3 text-slate-600">{r.featureGroups}</td>
                  <td className="px-4 py-3 text-slate-600">{r.serviceMappings}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.draft}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        onClick={() => void openDetail(r.id)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                      >
                        Details
                      </button>
                      <a
                        href={`/industries/${r.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                      >
                        <ExternalLink className="h-3 w-3" /> Public
                      </a>
                      <button
                        disabled={busy === r.id}
                        onClick={() => void toggleStatus(r)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        {r.status === "published" ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        {r.status === "published" ? "Hide" : "Publish"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                    No industries match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
  const modules = Array.isArray(detail.modules) ? (detail.modules as Array<Record<string, unknown>>) : [];
  const faqs = Array.isArray(detail.faqs) ? (detail.faqs as Array<Record<string, unknown>>) : [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{detail.name}</h2>
            <p className="text-sm text-slate-500">{detail.tagline}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Modules ({modules.length})
        </h3>
        <ul className="mb-4 space-y-1.5">
          {modules.map((mod, i) => (
            <li key={i} className="rounded border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <span className="font-medium text-slate-800">{String(mod.name ?? "")}</span>
              {mod.mandatory === true && (
                <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                  mandatory
                </span>
              )}
              <div className="text-xs text-slate-500">{String(mod.description ?? "")}</div>
            </li>
          ))}
        </ul>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          FAQs ({faqs.length})
        </h3>
        <ul className="space-y-2">
          {faqs.map((f, i) => (
            <li key={i} className="text-sm">
              <div className="font-medium text-slate-800">{String(f.q ?? "")}</div>
              <div className="text-slate-600">{String(f.a ?? "")}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const NEW_INDUSTRY_PRESET = `{
  "modules": [
    { "key": "core", "name": "Core Records", "description": "Primary entity records for this industry.", "mandatory": true }
  ],
  "features": [
    { "group": "Core", "items": ["Record management", "Search and filters"] }
  ],
  "challenges": [],
  "workflow": ["Capture", "Process", "Report"],
  "faqs": [],
  "reports": ["Operational summary"]
}`;

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [slug, setSlug] = React.useState("");
  const [name, setName] = React.useState("");
  const [tagline, setTagline] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [content, setContent] = React.useState(NEW_INDUSTRY_PRESET);
  const [error, setError] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    setError([]);
    setBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        setError(["content: invalid JSON"]);
        return;
      }
      const res = await fetch("/api/industries", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name, tagline, summary, status: "draft", ...(parsed as object) }),
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
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Register industry family</h2>
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
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Fisheries)"
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="slug (e.g. fisheries)"
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Hero tagline"
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Directory summary (2–400 chars)"
            rows={2}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            spellCheck={false}
            className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
            Cancel
          </button>
          <button
            disabled={busy || !name || !slug || !tagline || !summary}
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
