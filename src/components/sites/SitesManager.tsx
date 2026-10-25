"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Monitor,
  Plus,
  Globe,
  GitBranch,
  Loader2,
  ExternalLink,
  Settings,
} from "lucide-react";

interface SiteItem {
  id: string;
  name?: string | null;
  domain: string;
  runtime: string;
  status: string;
  gitRepo?: string | null;
  gitBranch?: string | null;
  createdAt: string;
}

export function SitesManager() {
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [runtime, setRuntime] = useState<"NEXTJS" | "NODE" | "STATIC" | "PHP82">("NEXTJS");
  const [gitRepo, setGitRepo] = useState("");

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites", { credentials: "include" });
      const body = await res.json();
      if (res.ok && body.success) {
        setSites(body.data?.sites || []);
      }
    } catch {
      toast.error("Failed to fetch sites");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await fetchSites();
    })();
    return () => {
      active = false;
    };
  }, [fetchSites]);

  async function handleCreateSite(e: React.FormEvent) {
    e.preventDefault();
    if (!domain.trim()) {
      toast.error("Domain is required");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim() || domain.trim(),
          domain: domain.trim(),
          runtime,
          gitRepo: gitRepo.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body.message || "Failed to create site");
        return;
      }
      toast.success(`Site ${domain} created`);
      setCreateOpen(false);
      setName("");
      setDomain("");
      setGitRepo("");
      fetchSites();
    } catch {
      toast.error("Error creating site");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sites &amp; Deployments</h1>
          <p className="text-sm text-slate-500">
            Create and manage Next.js, Node.js, PHP, and Static sites on ALO Labs Edge.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/ai/builder">
            <Button variant="outline">AI Site Builder</Button>
          </Link>
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Site
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[#E8501A]" />
        </div>
      ) : sites.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <Monitor className="h-10 w-10 text-[#E8501A] mb-3" />
            <h3 className="text-base font-bold text-slate-900">No sites deployed yet</h3>
            <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">
              Deploy a Next.js, React, Node.js, or static site with automatic Cloudflare SSL.
            </p>
            <Button
              onClick={() => setCreateOpen(true)}
              className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
            >
              <Plus className="mr-2 h-4 w-4" />
              Deploy First Site
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sites.map((site) => (
            <Card key={site.id} className="border-slate-200">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">
                      {site.name || site.domain}
                    </CardTitle>
                    <CardDescription className="text-xs flex items-center gap-1 mt-0.5">
                      <Globe className="h-3 w-3" />
                      {site.domain}
                    </CardDescription>
                  </div>
                  <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">
                    {site.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Badge variant="outline" className="text-[10px]">
                    {site.runtime}
                  </Badge>
                  {site.gitBranch && (
                    <span className="flex items-center gap-1 text-slate-400">
                      <GitBranch className="h-3 w-3" />
                      {site.gitBranch}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <Link href={`/sites/${site.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full text-xs">
                      <Settings className="h-3.5 w-3.5 mr-1.5" />
                      Manage
                    </Button>
                  </Link>
                  <a
                    href={`https://${site.domain}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Button variant="ghost" size="sm" className="text-xs">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deploy New Site</DialogTitle>
            <DialogDescription>
              Configure your domain, runtime, and optional Git repository.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSite} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="site-create-name">Project Name</Label>
              <Input
                id="site-create-name"
                placeholder="Production Portal"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-create-domain">Domain Name</Label>
              <Input
                id="site-create-domain"
                placeholder="app.alolabs.net"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-create-runtime">Runtime</Label>
              <select
                id="site-create-runtime"
                value={runtime}
                onChange={(e) =>
                  setRuntime(e.target.value as "NEXTJS" | "NODE" | "STATIC" | "PHP82")
                }
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="NEXTJS">Next.js 16 (App Router)</option>
                <option value="NODE">Node.js / Bun</option>
                <option value="STATIC">Static / React SPA</option>
                <option value="PHP82">PHP 8.2</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-create-git">Git Repository (Optional)</Label>
              <Input
                id="site-create-git"
                placeholder="https://github.com/org/repo"
                value={gitRepo}
                onChange={(e) => setGitRepo(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating}
                className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
              >
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create &amp; Deploy
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
