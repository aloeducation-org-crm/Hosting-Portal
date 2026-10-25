"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/authStore";
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
  Sparkles,
  Building2,
  Layers,
  Globe,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Rocket,
} from "lucide-react";

interface PlanItem {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  interval: string;
  maxSites?: number;
  maxStorageGb?: number;
  maxBandwidthGb?: number;
  maxAiTokens?: number;
  features: string;
  isPopular?: boolean;
}

const USE_CASES = [
  { id: "nextjs-saas", label: "Next.js SaaS Application", desc: "Full-stack app with PostgreSQL & AI" },
  { id: "agency-reseller", label: "Agency / Client Hosting", desc: "Manage multiple client sites & domains" },
  { id: "marketing-static", label: "Marketing & Static Sites", desc: "High-speed global edge static hosting" },
  { id: "ai-builder", label: "AI-Generated Website", desc: "Describe your business and auto-deploy" },
];

const RUNTIMES = [
  { id: "NEXTJS" as const, label: "Next.js 16 (App Router)", desc: "SSR, API routes & ISR" },
  { id: "NODE" as const, label: "Node.js / Bun Server", desc: "Express, Fastify or custom server" },
  { id: "STATIC" as const, label: "Static / React SPA", desc: "HTML, Vite or static bundle" },
  { id: "PHP82" as const, label: "PHP 8.2 / WordPress", desc: "FastCGI PHP runtime" },
];

export function OnboardingWizard() {
  const router = useRouter();
  const { user, checkSession } = useAuthStore();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [organizationName, setOrganizationName] = useState("");
  const [useCase, setUseCase] = useState("nextjs-saas");
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");

  const [siteName, setSiteName] = useState("");
  const [siteDomain, setSiteDomain] = useState("");
  const [siteRuntime, setSiteRuntime] = useState<"NEXTJS" | "NODE" | "STATIC" | "PHP82">("NEXTJS");
  const [gitRepo, setGitRepo] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/onboarding", { credentials: "include" });
        if (res.ok && !cancelled) {
          const body = await res.json();
          const data = body.data;
          if (data?.companyName) setOrganizationName(data.companyName);
          else if (user?.name) setOrganizationName(`${user.name}'s Workspace`);
          if (data?.useCase) setUseCase(data.useCase);
          if (Array.isArray(data?.availablePlans)) {
            setPlans(data.availablePlans);
            const activePlanId =
              data.activeSubscription?.planId || data.availablePlans[0]?.id || "";
            setSelectedPlanId(activePlanId);
          }
        }
      } catch {
        // fallback
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.name]);

  async function handleCompleteOnboarding() {
    setSaving(true);
    try {
      const res = await fetch("/api/auth/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          step: 4,
          completed: true,
          companyName: organizationName.trim() || undefined,
          organizationName: organizationName.trim() || undefined,
          useCase,
          planId: selectedPlanId || undefined,
          site:
            siteDomain.trim().length >= 3
              ? {
                  name: siteName.trim() || siteDomain.trim(),
                  domain: siteDomain.trim(),
                  runtime: siteRuntime,
                  gitRepo: gitRepo.trim() || undefined,
                }
              : undefined,
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body.message || "Failed to save onboarding settings");
        return;
      }

      await checkSession();
      toast.success("Onboarding complete! Welcome to ALO Labs Hosting Portal.");
      router.push("/dashboard");
    } catch {
      toast.error("An error occurred while saving onboarding.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-7 w-7 animate-spin text-[#E8501A]" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header & Stepper */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#E8501A] uppercase tracking-wider">
            <Sparkles className="h-3.5 w-3.5" />
            Quick Setup Wizard
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            Configure your ALO Labs Cloud Workspace
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                step === s
                  ? "bg-[#E8501A] text-white"
                  : step > s
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-200 text-slate-600"
              }`}
            >
              {step > s ? <CheckCircle2 className="h-4 w-4" /> : s}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Organization & Use Case */}
      {step === 1 && (
        <Card className="border-slate-200">
          <CardHeader>
            <div className="flex items-center gap-2 text-[#E8501A] text-xs font-semibold uppercase">
              <Building2 className="h-4 w-4" />
              Step 1 of 4
            </div>
            <CardTitle className="text-xl">Workspace &amp; Primary Use Case</CardTitle>
            <CardDescription>
              Name your organization workspace and tell us what you&apos;re building.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization / Team Name</Label>
              <Input
                id="org-name"
                placeholder="e.g. Acme Cloud Studio"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>What will you host primarily?</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {USE_CASES.map((uc) => (
                  <button
                    key={uc.id}
                    type="button"
                    onClick={() => setUseCase(uc.id)}
                    className={`flex flex-col items-start rounded-xl border p-3.5 text-left transition-all ${
                      useCase === uc.id
                        ? "border-[#E8501A] bg-[#FFF7ED]/70 ring-1 ring-[#E8501A]"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span className="text-sm font-semibold text-slate-900">
                      {uc.label}
                    </span>
                    <span className="text-xs text-slate-500 mt-1">{uc.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end border-t border-slate-100 pt-4">
            <Button
              onClick={() => setStep(2)}
              className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
            >
              Next: Select Plan
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 2: Select Hosting Plan */}
      {step === 2 && (
        <Card className="border-slate-200">
          <CardHeader>
            <div className="flex items-center gap-2 text-[#E8501A] text-xs font-semibold uppercase">
              <Layers className="h-4 w-4" />
              Step 2 of 4
            </div>
            <CardTitle className="text-xl">Choose Your Hosting Plan</CardTitle>
            <CardDescription>
              Start on our $0 Starter tier or unlock more sites, NVMe storage, and AI tokens.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const selected = selectedPlanId === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-all ${
                    selected
                      ? "border-[#E8501A] bg-[#FFF7ED]/60 ring-2 ring-[#E8501A]"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">{plan.name}</span>
                      {plan.priceCents === 0 && (
                        <Badge className="bg-emerald-600 text-white text-[10px]">
                          FREE
                        </Badge>
                      )}
                    </div>
                    <div className="text-2xl font-extrabold text-slate-900 mt-2">
                      ${(plan.priceCents / 100).toFixed(2)}
                      <span className="text-xs font-normal text-slate-500">
                        /{plan.interval}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{plan.description}</p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-200/70 space-y-1 text-xs text-slate-700">
                    <div>&bull; Up to {plan.maxSites ?? 5} sites</div>
                    <div>&bull; {plan.maxStorageGb ?? 1} GB SSD storage</div>
                    <div>&bull; {plan.maxBandwidthGb ?? 100} GB bandwidth</div>
                  </div>
                </button>
              );
            })}
          </CardContent>
          <CardFooter className="flex justify-between border-t border-slate-100 pt-4">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
            >
              Next: First Site
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 3: Optional First Website */}
      {step === 3 && (
        <Card className="border-slate-200">
          <CardHeader>
            <div className="flex items-center gap-2 text-[#E8501A] text-xs font-semibold uppercase">
              <Globe className="h-4 w-4" />
              Step 3 of 4
            </div>
            <CardTitle className="text-xl">Deploy Your First Site (Optional)</CardTitle>
            <CardDescription>
              Provision a site now or leave blank to create one later from the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="site-name">Project Name</Label>
                <Input
                  id="site-name"
                  placeholder="My Web App"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="site-domain">Domain / Subdomain</Label>
                <Input
                  id="site-domain"
                  placeholder="myapp.hosting.alolabs.net"
                  value={siteDomain}
                  onChange={(e) => setSiteDomain(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Application Runtime</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {RUNTIMES.map((rt) => (
                  <button
                    key={rt.id}
                    type="button"
                    onClick={() => setSiteRuntime(rt.id)}
                    className={`flex flex-col items-start rounded-xl border p-3 text-left ${
                      siteRuntime === rt.id
                        ? "border-[#E8501A] bg-[#FFF7ED]/70 ring-1 ring-[#E8501A]"
                        : "border-slate-200"
                    }`}
                  >
                    <span className="text-xs font-bold text-slate-900">
                      {rt.label}
                    </span>
                    <span className="text-[11px] text-slate-500">{rt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="git-repo">Git Repository URL (Optional)</Label>
              <Input
                id="git-repo"
                placeholder="https://github.com/username/my-nextjs-app"
                value={gitRepo}
                onChange={(e) => setGitRepo(e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t border-slate-100 pt-4">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={() => setStep(4)}
              className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
            >
              Review &amp; Finish
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 4: Summary & Launch */}
      {step === 4 && (
        <Card className="border-slate-200">
          <CardHeader>
            <div className="flex items-center gap-2 text-emerald-600 text-xs font-semibold uppercase">
              <Rocket className="h-4 w-4" />
              Step 4 of 4 — Ready to Launch
            </div>
            <CardTitle className="text-xl">Your Hosting Portal is Ready</CardTitle>
            <CardDescription>
              Review your setup below and launch your ALO Labs workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Organization Workspace:</span>
                <span className="font-semibold text-slate-900">
                  {organizationName || "Default Workspace"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Primary Use Case:</span>
                <span className="font-semibold text-slate-900">
                  {USE_CASES.find((u) => u.id === useCase)?.label || useCase}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Selected Plan:</span>
                <span className="font-semibold text-slate-900">
                  {plans.find((p) => p.id === selectedPlanId)?.name || "Starter ($0/mo)"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Initial Site:</span>
                <span className="font-semibold text-slate-900">
                  {siteDomain.trim()
                    ? `${siteDomain.trim()} (${siteRuntime})`
                    : "Skip for now"}
                </span>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t border-slate-100 pt-4">
            <Button variant="outline" onClick={() => setStep(3)} disabled={saving}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={handleCompleteOnboarding}
              disabled={saving}
              className="bg-[#E8501A] hover:bg-[#C73D12] text-white font-semibold"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Complete Setup &amp; Open Dashboard
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
