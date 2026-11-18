"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Globe,
  GitBranch,
  KeyRound,
  Terminal,
  Settings,
  ArrowLeft,
  Loader2,
  ShieldAlert,
  RefreshCw,
  Server,
} from "lucide-react";

type SiteDomain = { id: string; domain: string; sslStatus?: string | null };
type SiteDetail = {
  id: string;
  domain: string;
  runtime: string;
  status: string;
  applicationPort?: number | null;
  healthPath?: string | null;
  createdAt?: string;
  domains?: SiteDomain[];
  healthCheck?: { status?: string | null; lastCheckAt?: string | null } | null;
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  DEPLOYING: "bg-amber-100 text-amber-800",
  RESTARTING: "bg-amber-100 text-amber-800",
  SUSPENDED: "bg-slate-200 text-slate-700",
  DELETED: "bg-red-100 text-red-800",
};

export default function SiteDetailPage() {
  const params = useParams<{ id: string }>();
  const siteId = params?.id ?? "";
  const [site, setSite] = useState<SiteDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not-found" | "forbidden" | "error">("loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/websites/${encodeURIComponent(siteId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 404) {
        setState("not-found");
        return;
      }
      if (res.status === 403) {
        setState("forbidden");
        return;
      }
      if (res.status === 401) {
        setState("error");
        setMessage("Your session has expired. Sign in again to view this site.");
        return;
      }
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.success || !payload?.data) {
        setState("error");
        setMessage(payload?.message ?? "Could not load this site. Please try again.");
        return;
      }
      setSite(payload.data as SiteDetail);
      setState("ready");
    } catch {
      setState("error");
      setMessage("Network error while loading this site.");
    }
  }, [siteId]);

  useEffect(() => {
    // Data fetch on mount: every setState inside `load` happens after an
    // `await` (i.e. asynchronously), which is the pattern this rule allows;
    // the linter cannot prove it across the useCallback boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (siteId) void load();
  }, [siteId, load]);

  const retry = useCallback(() => {
    setState("loading");
    setMessage("");
    void load();
  }, [load]);

  const sections = [
    { label: "Deployments", href: `/sites/${siteId}/deployments`, icon: GitBranch, desc: "Release history, previews & instant rollback" },
    { label: "Custom Domains & SSL", href: `/sites/${siteId}/domains`, icon: Globe, desc: "DNS records & certificate status" },
    { label: "Environment Variables", href: `/sites/${siteId}/env`, icon: KeyRound, desc: "AES-256 encrypted runtime secrets" },
    { label: "Build & Runtime Logs", href: `/sites/${siteId}/logs`, icon: Terminal, desc: "Build and process logs" },
    { label: "Site Settings", href: `/sites/${siteId}/settings`, icon: Settings, desc: "Runtime, build command & lifecycle controls" },
  ];

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin text-[#E8501A]" />
        <span className="ml-3 text-sm">Loading site…</span>
      </div>
    );
  }

  if (state === "not-found" || state === "forbidden" || (state === "error" && !site)) {
    const title =
      state === "not-found" ? "Site not found" : state === "forbidden" ? "Access denied" : "Could not load site";
    const detail =
      state === "not-found"
        ? "This site does not exist or was deleted."
        : state === "forbidden"
          ? "You do not have permission to view this site."
          : message;
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-[#E8501A]" />
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500">{detail}</p>
        <div className="flex items-center justify-center gap-3">
          <Button asChild variant="outline" size="sm">
            <Link href="/sites">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> All sites
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const statusStyle = STATUS_STYLES[site?.status ?? ""] ?? "bg-slate-200 text-slate-700";

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/sites" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-[#E8501A]">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Sites
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-1 break-all">{site?.domain ?? siteId}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" /> {site?.runtime ?? "unknown runtime"}
            </span>
            {site?.applicationPort ? <span className="font-mono">port {site.applicationPort}</span> : null}
            {site?.healthPath ? <span className="font-mono">health {site.healthPath}</span> : null}
            <span className="font-mono text-slate-400">id {site?.id}</span>
          </div>
        </div>
        <Badge className={statusStyle}>{site?.status ?? "UNKNOWN"}</Badge>
      </div>

      {site?.domains && site.domains.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {site.domains.map((d) => (
            <span
              key={d.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600"
            >
              <Globe className="h-3 w-3" />
              {d.domain}
              {d.sslStatus ? <span className="text-slate-400">· SSL {d.sslStatus}</span> : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.href} className="border-slate-200 hover:border-[#E8501A] transition-colors h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Icon className="h-4 w-4 text-[#E8501A]" />
                  {s.label}
                </CardTitle>
                <CardDescription className="text-xs">{s.desc}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" size="sm" className="text-xs">
                  <Link href={s.href}>Open {s.label}</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
