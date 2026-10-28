"use client";

/**
 * Backup center (spec §16) — a factual view over /api/backups.
 * Rows are whatever the backup pipeline actually recorded; an empty list is
 * reported as "none recorded", never as a fabricated healthy state. Creation
 * happens per site (Sites → Backups) or through the backup worker; this page
 * does not pretend to trigger jobs that have no backend behind them.
 */
import { useCallback, useEffect, useState } from "react";
import { Archive, RefreshCw, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface BackupRow {
  id: string;
  status?: string | null;
  backupType?: string | null;
  fileSize?: number | string | null;
  createdAt: string;
  website?: { name?: string | null; domain?: string | null } | null;
}

function formatSize(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let x = n;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  return `${Math.round(x * 10) / 10} ${units[i]}`;
}

export function BackupsCenter() {
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/backups", { cache: "no-store" });
      if (!res.ok) throw new Error(`backups endpoint returned ${res.status}`);
      const body = (await res.json()) as { data?: BackupRow[] };
      setRows(Array.isArray(body.data) ? body.data : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load backups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const statusStyle = (s?: string | null) => {
    const v = (s ?? "").toLowerCase();
    if (v === "completed" || v === "success" || v === "ok") return "bg-emerald-100 text-emerald-800";
    if (v === "failed" || v === "error") return "bg-red-100 text-red-800";
    if (v === "running" || v === "pending" || v === "in_progress") return "bg-amber-100 text-amber-800";
    return "bg-slate-100 text-slate-700";
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-purple-600">
            <Archive className="h-3.5 w-3.5" />
            Recovery
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Backups</h1>
          <p className="text-sm text-slate-500">
            Recorded backup runs and their real outcomes. Restore drills execute only on an enrolled host with a
            verified artifact — this page never claims a restore that did not happen.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      <Card className="border-slate-200 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Archive className="h-4 w-4 text-[#E8501A]" />
            Backup runs ({rows.length})
          </CardTitle>
          <CardDescription className="text-xs">
            Scope: super admins see every recorded run; other roles see backups they created.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[#E8501A]" />
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              No backup runs recorded yet. Create one from{" "}
              <span className="font-medium text-slate-700">Sites → [site] → Backups</span>, or run the backup worker on
              an enrolled host — recorded runs will appear here with their real status.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-y border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Site</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Size</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-xs font-medium text-slate-800">
                        {b.website?.name || b.website?.domain || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{b.backupType ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{formatSize(b.fileSize)}</td>
                      <td className="px-4 py-3">
                        <Badge className={statusStyle(b.status)}>{b.status ?? "unknown"}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
