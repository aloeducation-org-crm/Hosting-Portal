"use client";

/**
 * Monitoring center (spec §17) — renders ONLY measured data:
 *   - host gauges come from /api/monitoring/metrics (live statfs/loadavg on
 *     the serving host, `source: "system"`),
 *   - alerts come from /api/alerts (role-scoped by the API),
 *   - a value the system did not measure renders as "not measured", never 0.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Gauge,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Metrics {
  source: string;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  bandwidth: number | null;
  timestamp: string;
  systemInfo?: {
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    cpuCount: number;
    load1: number;
    load5: number;
    load15: number;
  };
}

interface AlertRow {
  id: string;
  severity: string;
  message?: string;
  isRead: boolean;
  createdAt: string;
  rule?: { name: string; metric: string } | null;
}

function formatBytes(n: number | undefined | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "not measured";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${Math.round(v * 10) / 10} ${units[i]}`;
}

function GaugeBar({ label, value }: { label: string; value: number | null }) {
  const pct = typeof value === "number" ? Math.max(0, Math.min(100, value)) : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-900">
          {pct === null ? <span className="text-xs font-normal text-slate-400">not measured</span> : `${pct.toFixed(1)}%`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        {pct !== null && (
          <div
            className={`h-full rounded-full transition-all ${pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function MonitoringCenter() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [mRes, aRes] = await Promise.all([
        fetch("/api/monitoring/metrics", { cache: "no-store" }),
        fetch("/api/alerts?limit=20", { cache: "no-store" }),
      ]);
      if (!mRes.ok) throw new Error(`metrics endpoint returned ${mRes.status}`);
      const mBody = (await mRes.json()) as { data?: Metrics };
      setMetrics(mBody.data ?? null);
      if (aRes.ok) {
        const aBody = (await aRes.json()) as { data?: { alerts?: AlertRow[] } | AlertRow[] };
        const rows = Array.isArray(aBody.data) ? aBody.data : (aBody.data?.alerts ?? []);
        setAlerts(rows);
      } else {
        setAlerts([]);
      }
      setError(null);
      setUpdatedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load monitoring data");
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
    const interval = setInterval(() => void tick(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [load]);

  const severityStyle = (s: string) =>
    s.toLowerCase() === "critical" || s.toLowerCase() === "error"
      ? "bg-red-100 text-red-800"
      : s.toLowerCase() === "warning"
        ? "bg-amber-100 text-amber-800"
        : "bg-slate-100 text-slate-700";

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-purple-600">
            <Activity className="h-3.5 w-3.5" />
            Observability
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Monitoring</h1>
          <p className="text-sm text-slate-500">
            Live host metrics measured on the serving system, plus role-scoped alert events. Values are never
            fabricated: anything unmeasured is labelled as such.
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
            <Gauge className="h-4 w-4 text-[#E8501A]" />
            Host resources
            {metrics?.source && (
              <Badge className="ml-2 bg-emerald-100 text-emerald-800">source: {metrics.source}</Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            {metrics?.timestamp ? `Measured ${new Date(metrics.timestamp).toLocaleTimeString()}` : "Awaiting first measurement"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          <GaugeBar label="CPU (load-based)" value={metrics?.cpu ?? null} />
          <GaugeBar label="Memory" value={metrics?.memory ?? null} />
          <GaugeBar label="Disk" value={metrics?.disk ?? null} />
          <div className="sm:col-span-3 grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t border-slate-100 text-xs text-slate-600">
            <div>
              <div className="text-slate-400">Cores</div>
              <div className="font-semibold">{metrics?.systemInfo?.cpuCount ?? "not measured"}</div>
            </div>
            <div>
              <div className="text-slate-400">Load (1/5/15m)</div>
              <div className="font-semibold">
                {metrics?.systemInfo
                  ? `${metrics.systemInfo.load1.toFixed(2)} / ${metrics.systemInfo.load5.toFixed(2)} / ${metrics.systemInfo.load15.toFixed(2)}`
                  : "not measured"}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Total memory</div>
              <div className="font-semibold">{formatBytes(metrics?.systemInfo?.totalMemoryBytes ?? null)}</div>
            </div>
            <div>
              <div className="text-slate-400">Free memory</div>
              <div className="font-semibold">{formatBytes(metrics?.systemInfo?.freeMemoryBytes ?? null)}</div>
            </div>
            <div>
              <div className="text-slate-400">Bandwidth</div>
              <div className="font-semibold text-slate-400">
                {metrics?.bandwidth == null ? "not sampled" : String(metrics.bandwidth)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#E8501A]" />
            Recent alerts ({alerts.length})
          </CardTitle>
          <CardDescription className="text-xs">
            {updatedAt ? `Loaded ${new Date(updatedAt).toLocaleTimeString()} · non-admins see only their own alert rules` : "Loading…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {alerts.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              No alert events recorded. Alert rules live under{" "}
              <span className="font-medium text-slate-700">Settings → Alerts</span>; events appear here when a rule fires.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-y border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Rule</th>
                    <th className="px-4 py-3">Message</th>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {alerts.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <Badge className={severityStyle(a.severity)}>{a.severity}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{a.rule?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-md truncate">{a.message ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(a.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={a.isRead ? "bg-slate-100 text-slate-500" : "bg-blue-100 text-blue-800"}>
                          {a.isRead ? "read" : "open"}
                        </Badge>
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
