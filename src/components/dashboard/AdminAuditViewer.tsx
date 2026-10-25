"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileText, Search, Shield, Loader2 } from "lucide-react";

interface AuditLogEntry {
  id: string;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  domain?: string | null;
  result?: string | null;
  ipAddress?: string | null;
  timestamp: string;
}

export function AdminAuditViewer() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actorEmail, setActorEmail] = useState("");

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (actorEmail.trim()) params.set("actorEmail", actorEmail.trim());
      const res = await fetch(`/api/audit-logs?${params.toString()}`, {
        credentials: "include",
      });
      const body = await res.json();
      if (res.ok && body.success) {
        setLogs(body.data?.logs || []);
      }
    } finally {
      setLoading(false);
    }
  }, [actorEmail]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await fetchLogs();
    })();
    return () => {
      active = false;
    };
  }, [fetchLogs]);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-purple-600">
          <Shield className="h-3.5 w-3.5" />
          Security &amp; Compliance
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">
          Platform Audit Logs
        </h1>
        <p className="text-sm text-slate-500">
          Immutable audit trail for authentication events, user updates, deployments, and server mutations.
        </p>
      </div>

      <Card className="border-slate-200">
        <CardContent className="p-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Filter by actor email..."
              value={actorEmail}
              onChange={(e) => setActorEmail(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#E8501A]" />
            Audit Events ({logs.length})
          </CardTitle>
          <CardDescription className="text-xs">
            Most recent administrative and security actions
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[#E8501A]" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-y border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Actor</th>
                    <th className="px-4 py-3">Resource</th>
                    <th className="px-4 py-3">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">
                        {log.action}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {log.actorEmail || "system"}
                        {log.actorRole && (
                          <span className="ml-1.5 text-[10px] text-slate-400">
                            ({log.actorRole})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {log.resourceType || "—"}
                        {log.domain ? ` (${log.domain})` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            log.result === "FAILURE"
                              ? "bg-red-100 text-red-800"
                              : "bg-emerald-100 text-emerald-800"
                          }
                        >
                          {log.result || "SUCCESS"}
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
