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
  CardFooter,
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
  Layers,
  Plus,
  Check,
  Loader2,
  Shield,
} from "lucide-react";

interface PlanRecord {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  priceCents: number;
  interval: string;
  maxSites?: number;
  maxBandwidthGb?: number;
  maxStorageGb?: number;
  maxDatabases?: number;
  maxAiTokens?: number;
  resellerCommissionPct?: number;
  features: string;
  isActive: boolean;
}

export function AdminPlansManager() {
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceDollars, setPriceDollars] = useState("9.99");
  const [maxSites, setMaxSites] = useState("10");
  const [maxStorageGb, setMaxStorageGb] = useState("5");
  const [maxBandwidthGb, setMaxBandwidthGb] = useState("500");
  const [maxAiTokens, setMaxAiTokens] = useState("50000");
  const [resellerCommissionPct, setResellerCommissionPct] = useState("10");

  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch("/api/pricing/plans?includeInactive=true", {
        credentials: "include",
      });
      const body = await res.json();
      if (res.ok && body.success) {
        setPlans(body.data || []);
      }
    } catch {
      toast.error("Failed to load plans");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await fetchPlans();
    })();
    return () => {
      active = false;
    };
  }, [fetchPlans]);

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Plan name is required");
      return;
    }
    setSaving(true);
    try {
      const priceCents = Math.round(parseFloat(priceDollars || "0") * 100);
      const res = await fetch("/api/pricing/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || "Custom hosting plan",
          priceCents,
          interval: "monthly",
          maxSites: Number(maxSites) || 10,
          maxStorageGb: Number(maxStorageGb) || 5,
          maxBandwidthGb: Number(maxBandwidthGb) || 500,
          maxAiTokens: Number(maxAiTokens) || 50000,
          resellerCommissionPct: Number(resellerCommissionPct) || 0,
          features: [
            `Up to ${maxSites} websites`,
            `${maxStorageGb} GB SSD storage`,
            `${maxBandwidthGb} GB bandwidth`,
            `${Number(maxAiTokens).toLocaleString()} AI tokens / mo`,
            "Free Cloudflare SSL",
          ],
          isActive: true,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body.message || "Could not create plan");
        return;
      }
      toast.success(`Plan ${name} created`);
      setCreateOpen(false);
      setName("");
      setDescription("");
      fetchPlans();
    } catch {
      toast.error("Error creating plan");
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePlan(plan: PlanRecord) {
    try {
      const res = await fetch("/api/pricing/plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: plan.id, isActive: !plan.isActive }),
      });
      const body = await res.json();
      if (res.ok && body.success) {
        toast.success(
          `Plan ${plan.name} ${!plan.isActive ? "enabled" : "disabled"}`
        );
        fetchPlans();
      }
    } catch {
      toast.error("Failed to update plan");
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-purple-600">
            <Shield className="h-3.5 w-3.5" />
            Admin Billing &amp; Quota Tiers
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            Hosting Plans &amp; Limits
          </h1>
          <p className="text-sm text-slate-500">
            Configure free &amp; paid tiers, resource quotas, AI token caps, and reseller commissions.
          </p>
        </div>

        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Plan
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[#E8501A]" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {plans.map((plan) => {
            let featureList: string[] = [];
            try {
              featureList = JSON.parse(plan.features);
            } catch {
              featureList = [plan.features];
            }

            return (
              <Card
                key={plan.id}
                className="border-slate-200 flex flex-col justify-between"
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Layers className="h-4 w-4 text-[#E8501A]" />
                      {plan.name}
                    </CardTitle>
                    <Badge
                      className={
                        plan.isActive
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-600"
                      }
                    >
                      {plan.isActive ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                  <div className="text-3xl font-extrabold text-slate-900 mt-2">
                    ${(plan.priceCents / 100).toFixed(2)}
                    <span className="text-xs font-normal text-slate-500">
                      /{plan.interval}
                    </span>
                  </div>
                  <CardDescription className="text-xs">
                    {plan.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs">
                    <div>
                      <span className="text-slate-400 block">Max Sites</span>
                      <span className="font-bold text-slate-800">
                        {plan.maxSites ?? 5}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Storage</span>
                      <span className="font-bold text-slate-800">
                        {plan.maxStorageGb ?? 1} GB
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">AI Tokens</span>
                      <span className="font-bold text-slate-800">
                        {(plan.maxAiTokens ?? 10000).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Reseller Comm.</span>
                      <span className="font-bold text-slate-800">
                        {plan.resellerCommissionPct ?? 0}%
                      </span>
                    </div>
                  </div>

                  <ul className="space-y-1.5 text-xs text-slate-600">
                    {featureList.slice(0, 5).map((f, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>

                <CardFooter className="border-t border-slate-100 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTogglePlan(plan)}
                    className="w-full text-xs"
                  >
                    {plan.isActive ? "Disable Plan" : "Enable Plan"}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Plan Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Hosting Plan</DialogTitle>
            <DialogDescription>
              Define pricing, resource quotas, and reseller commission percentage.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreatePlan} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="plan-name">Plan Name</Label>
                <Input
                  id="plan-name"
                  placeholder="Pro Agency"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plan-price">Monthly Price (USD)</Label>
                <Input
                  id="plan-price"
                  type="number"
                  step="0.01"
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="plan-desc">Description</Label>
              <Input
                id="plan-desc"
                placeholder="For high-traffic apps and agencies"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="space-y-1">
                <Label htmlFor="plan-sites">Max Sites</Label>
                <Input
                  id="plan-sites"
                  type="number"
                  value={maxSites}
                  onChange={(e) => setMaxSites(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plan-storage">Storage (GB)</Label>
                <Input
                  id="plan-storage"
                  type="number"
                  value={maxStorageGb}
                  onChange={(e) => setMaxStorageGb(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plan-bw">Bandwidth (GB)</Label>
                <Input
                  id="plan-bw"
                  type="number"
                  value={maxBandwidthGb}
                  onChange={(e) => setMaxBandwidthGb(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="plan-ai">AI Tokens / Month</Label>
                <Input
                  id="plan-ai"
                  type="number"
                  value={maxAiTokens}
                  onChange={(e) => setMaxAiTokens(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plan-comm">Reseller Commission (%)</Label>
                <Input
                  id="plan-comm"
                  type="number"
                  value={resellerCommissionPct}
                  onChange={(e) => setResellerCommissionPct(e.target.value)}
                />
              </div>
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
                disabled={saving}
                className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Plan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
