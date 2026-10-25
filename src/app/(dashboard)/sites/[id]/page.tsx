"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe, GitBranch, KeyRound, Terminal, Settings, ArrowLeft } from "lucide-react";

export default function SiteDetailPage() {
  const params = useParams<{ id: string }>();
  const siteId = params?.id || "site";

  const sections = [
    { label: "Deployments", href: `/sites/${siteId}/deployments`, icon: GitBranch, desc: "Release history, previews & instant rollback" },
    { label: "Custom Domains & SSL", href: `/sites/${siteId}/domains`, icon: Globe, desc: "Cloudflare CNAME & automatic SSL certificates" },
    { label: "Environment Variables", href: `/sites/${siteId}/env`, icon: KeyRound, desc: "AES-256 encrypted runtime secrets" },
    { label: "Build & Runtime Logs", href: `/sites/${siteId}/logs`, icon: Terminal, desc: "Real-time build and PM2 process logs" },
    { label: "Site Settings", href: `/sites/${siteId}/settings`, icon: Settings, desc: "Runtime, build command & lifecycle controls" },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/sites" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-[#E8501A]">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Sites
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Site Control Panel</h1>
          <p className="text-xs text-slate-500 font-mono">ID: {siteId}</p>
        </div>
        <Badge className="bg-emerald-100 text-emerald-800">ACTIVE</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href}>
              <Card className="border-slate-200 hover:border-[#E8501A] transition-colors h-full">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Icon className="h-4 w-4 text-[#E8501A]" />
                    {s.label}
                  </CardTitle>
                  <CardDescription className="text-xs">{s.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" size="sm" className="text-xs">
                    Open {s.label}
                  </Button>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
