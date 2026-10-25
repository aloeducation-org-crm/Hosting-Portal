"use client";

import React, { useEffect, useState, useCallback } from "react";
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
  Server,
  Plus,
  Cpu,
  HardDrive,
  Activity,
  Loader2,
  Shield,
  Wrench,
} from "lucide-react";

interface ServerRecord {
  id: string;
  name?: string | null;
  hostname: string;
  ip?: string | null;
  tailscaleIp?: string | null;
  region?: string;
  role?: string;
  status?: string;
  os?: string | null;
  cpuCores?: number | null;
  ramGb?: number | null;
  diskGb?: number | null;
  maxSites?: number;
}

export function AdminServersManager() {
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [ip, setIp] = useState("");
  const [region, setRegion] = useState("ap-south-1");
  const [role, setRole] = useState<"WEB" | "DATABASE" | "AI" | "LOAD_BALANCER">("WEB");
  const [cpuCores, setCpuCores] = useState("4");
  const [ramGb, setRamGb] = useState("15");
  const [diskGb, setDiskGb] = useState("100");

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch("/api/servers", { credentials: "include" });
      const body = await res.json();
      if (res.ok && body.success) {
        const list = body.data?.servers || (body.data?.hostname ? [body.data] : []);
        setServers(list);
      }
    } catch {
      toast.error("Failed to fetch servers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await fetchServers();
    })();
    return () => {
      active = false;
    };
  }, [fetchServers]);

  async function handleAddServer(e: React.FormEvent) {
    e.preventDefault();
    if (!hostname.trim() || !ip.trim()) {
      toast.error("Hostname and IP address are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim() || hostname.trim(),
          hostname: hostname.trim(),
          ip: ip.trim(),
          region,
          role,
          cpuCores: Number(cpuCores) || 4,
          ramGb: Number(ramGb) || 15,
          diskGb: Number(diskGb) || 100,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body.message || "Failed to provision server");
        return;
      }
      toast.success(`Server ${hostname} registered`);
      setAddOpen(false);
      setName("");
      setHostname("");
      setIp("");
      fetchServers();
    } catch {
      toast.error("Error adding server");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(srv: ServerRecord) {
    const nextStatus = srv.status === "ONLINE" ? "MAINTENANCE" : "ONLINE";
    try {
      const res = await fetch("/api/servers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: srv.id, status: nextStatus }),
      });
      const body = await res.json();
      if (res.ok && body.success) {
        toast.success(`${srv.hostname} set to ${nextStatus}`);
        fetchServers();
      }
    } catch {
      toast.error("Failed to update server status");
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-purple-600">
            <Shield className="h-3.5 w-3.5" />
            Admin Infrastructure Control
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            Servers &amp; Edge Nodes
          </h1>
          <p className="text-sm text-slate-500">
            Monitor Ubuntu 22.04 nodes, Cloudflare tunnels, and PM2/Nginx capacity.
          </p>
        </div>

        <Button
          onClick={() => setAddOpen(true)}
          className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
        >
          <Plus className="mr-2 h-4 w-4" />
          Provision Node
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[#E8501A]" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {servers.map((srv) => (
            <Card key={srv.id} className="border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
                      <Server className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">
                        {srv.name || srv.hostname}
                      </CardTitle>
                      <CardDescription className="text-xs font-mono">
                        {srv.hostname} &bull; {srv.ip || "127.0.0.1"}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge
                    className={
                      srv.status === "MAINTENANCE"
                        ? "bg-amber-100 text-amber-800 border-amber-200"
                        : "bg-emerald-100 text-emerald-800 border-emerald-200"
                    }
                  >
                    {srv.status || "ONLINE"}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                    <div className="flex items-center gap-1 text-slate-500">
                      <Cpu className="h-3.5 w-3.5" />
                      CPU
                    </div>
                    <div className="font-bold text-slate-900 mt-1">
                      {srv.cpuCores ?? 4} vCPU
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                    <div className="flex items-center gap-1 text-slate-500">
                      <Activity className="h-3.5 w-3.5" />
                      Memory
                    </div>
                    <div className="font-bold text-slate-900 mt-1">
                      {srv.ramGb ?? 15} GB RAM
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
                    <div className="flex items-center gap-1 text-slate-500">
                      <HardDrive className="h-3.5 w-3.5" />
                      Storage
                    </div>
                    <div className="font-bold text-slate-900 mt-1">
                      {srv.diskGb ?? 100} GB SSD
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-3">
                  <div>
                    OS: <span className="font-medium text-slate-700">{srv.os || "Ubuntu 22.04 LTS"}</span> &bull; Role:{" "}
                    <span className="font-medium text-slate-700">{srv.role || "WEB"}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleStatus(srv)}
                    className="h-7 text-xs"
                  >
                    <Wrench className="h-3 w-3 mr-1" />
                    {srv.status === "MAINTENANCE" ? "Set Online" : "Maintenance"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Provision Server Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Provision New Server Node</DialogTitle>
            <DialogDescription>
              Register an Ubuntu node to the ALO Labs hosting cluster.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddServer} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="srv-name">Node Label</Label>
                <Input
                  id="srv-name"
                  placeholder="EU Edge Node 1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="srv-host">Hostname</Label>
                <Input
                  id="srv-host"
                  placeholder="eu1.hosting.alolabs.net"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="srv-ip">Public / Tailscale IP</Label>
                <Input
                  id="srv-ip"
                  placeholder="100.85.239.115"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="srv-region">Region</Label>
                <Input
                  id="srv-region"
                  placeholder="ap-south-1"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label htmlFor="srv-role">Role</Label>
                <select
                  id="srv-role"
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as "WEB" | "DATABASE" | "AI" | "LOAD_BALANCER")
                  }
                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-2 text-xs"
                >
                  <option value="WEB">WEB</option>
                  <option value="DATABASE">DATABASE</option>
                  <option value="AI">AI</option>
                  <option value="LOAD_BALANCER">LB</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="srv-cpu">CPU Cores</Label>
                <Input
                  id="srv-cpu"
                  type="number"
                  value={cpuCores}
                  onChange={(e) => setCpuCores(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="srv-ram">RAM (GB)</Label>
                <Input
                  id="srv-ram"
                  type="number"
                  value={ramGb}
                  onChange={(e) => setRamGb(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="srv-disk">Disk (GB)</Label>
                <Input
                  id="srv-disk"
                  type="number"
                  value={diskGb}
                  onChange={(e) => setDiskGb(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Register Server
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
