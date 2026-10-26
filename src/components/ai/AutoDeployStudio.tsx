"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Activity,
  Bot,
  CheckCircle2,
  Code2,
  Copy,
  Cpu,
  ExternalLink,
  FileText,
  GitBranch,
  Globe,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type WorkloadCategory = "web" | "server" | "mobile";

interface Blueprint {
  id: string;
  name: string;
  workloadCategory: WorkloadCategory;
  framework: string;
  runtime: string;
  websiteRuntime: "STATIC" | "PHP82" | "NODE" | "NEXTJS";
  summary: string;
  serviceManager: string;
  defaultPort: number;
  healthPath: string;
  installCmd: string | null;
  buildCmd: string | null;
  startCmd: string | null;
  outputDir: string;
  defaultEnvKeys: Array<{ key: string; secret: boolean; autoGenerate: boolean; description: string }>;
  highlights: string[];
}

interface ArchitectPlan {
  appName: string;
  domain: string;
  repository: string | null;
  branch: string;
  workloadCategory: WorkloadCategory;
  framework: string;
  runtime: string;
  websiteRuntime: "STATIC" | "PHP82" | "NODE" | "NEXTJS";
  allocatedPort?: number;
  deployConfig: Record<string, unknown> & {
    installCmd: string | null;
    buildCmd: string | null;
    startCmd: string | null;
    outputDir: string;
    port: number;
    healthPath: string;
    serviceManager: string;
  };
  requiredEnvKeys: Array<{ key: string; secret: boolean; autoGenerate: boolean; description: string }>;
  sslAutoIssue: boolean;
  autoDeployOnPush: boolean;
  aiEnhanced: boolean;
  aiProviderUsed: string | null;
  aiSummary: string;
  shareableBriefYaml?: string;
  nginxConfig?: string;
  cloudflareDnsRecord?: { type: string; name: string; content: string; proxied: boolean };
  cliDeployCommand?: string;
  verificationCommands?: string[];
  steps: string[];
  warnings: string[];
}

interface ServerEnvironmentInfo {
  spec: {
    hostName: string;
    os: string;
    publicIp: string;
    baseDomain: string;
    nodeVersion: string;
    npmVersion: string;
    processManager: string;
    reverseProxy: string;
    databaseOptions: string[];
    cdnDns: string;
    sslStatus: string;
    controlPlane: { domain: string; pm2App: string; port: number };
  };
  nextAvailablePort: number;
  portRegistry: Array<{
    domain: string;
    pm2App: string;
    port: number;
    role: "control-plane" | "tenant-app";
    status: string;
  }>;
}

interface ManagedProject {
  websiteId: string;
  name: string;
  domain: string;
  status: string;
  websiteRuntime: string;
  workloadCategory: WorkloadCategory;
  framework: string;
  port: number | null;
  healthPath: string;
  sslEnabled: boolean;
  gitProject: {
    id: string;
    repository: string;
    productionBranch: string;
    autoDeploy: boolean;
    serviceManager: string;
    lastDeployStatus: string | null;
  } | null;
  latestDeployment: {
    id: string;
    status: string;
    stage: string | null;
    createdAt: string;
  } | null;
  createdAt: string;
}

interface AutomationServerInfo {
  status: string;
  aiProviderChainReady: boolean;
  activeProviders: Array<{ id: string; label: string; tier: string; model: string }>;
  scopedHostingTools: string[];
  seededAiAgents: number;
  configuredWorkflows: number;
  selfHostedAgentCatalogCount: number;
  pendingOperations: number;
  cisBaseline?: {
    reference: string;
    license: string;
    summary: { passed: number; warnings: number; info: number };
    controls?: Array<{ controlId: string; title: string; status: string; detail: string }>;
  };
}

function CategoryBadge({ category }: { category: WorkloadCategory | string }) {
  if (category === "mobile") {
    return (
      <Badge variant="outline" className="gap-1 bg-violet-500/10 text-violet-700 border-violet-500/30">
        <Smartphone className="h-3 w-3" /> MOBILE APP
      </Badge>
    );
  }
  if (category === "server") {
    return (
      <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-800 border-amber-500/30">
        <Server className="h-3 w-3" /> SERVER / API
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 bg-sky-500/10 text-sky-700 border-sky-500/30">
      <Globe className="h-3 w-3" /> WEB APP
    </Badge>
  );
}

export function AutoDeployStudio() {
  const [serverEnv, setServerEnv] = useState<ServerEnvironmentInfo | null>(null);
  const [serverInfo, setServerInfo] = useState<AutomationServerInfo | null>(null);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [projects, setProjects] = useState<ManagedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<"all" | WorkloadCategory>("all");
  const [reviewTab, setReviewTab] = useState<"plan" | "brief" | "nginx">("plan");

  // AI Setup Architect inputs
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string>("nextjs-fullstack");
  const [prompt, setPrompt] = useState<string>("");
  const [appName, setAppName] = useState<string>("");
  const [domain, setDomain] = useState<string>("");
  const [repository, setRepository] = useState<string>("");
  const [branch, setBranch] = useState<string>("main");
  const [manifestJson, setManifestJson] = useState<string>("");
  const [manifestFilename, setManifestFilename] = useState<string>("package.json");

  // Generated Plan & Provisioning state
  const [architecting, setArchitecting] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [plan, setPlan] = useState<ArchitectPlan | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [sslAutoIssue, setSslAutoIssue] = useState(true);
  const [autoDeployOnPush, setAutoDeployOnPush] = useState(true);

  const loadStudio = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/auto-deploy", { credentials: "same-origin" });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.message || "Failed to load AI Auto-Deploy Studio");
      }
      setServerEnv(body.data.serverEnvironment ?? null);
      setServerInfo(body.data.automationServer);
      setBlueprints(body.data.blueprints ?? []);
      setProjects(body.data.managedProjects ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load AI Auto-Deploy Studio");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await loadStudio();
    })();
    return () => {
      active = false;
    };
  }, [loadStudio]);

  const filteredBlueprints = useMemo(() => {
    if (filterCategory === "all") return blueprints;
    return blueprints.filter((bp) => bp.workloadCategory === filterCategory);
  }, [blueprints, filterCategory]);

  const handleSelectBlueprint = (bp: Blueprint) => {
    setSelectedBlueprintId(bp.id);
    if (!appName) setAppName(bp.id);
    if (!domain) setDomain(`${bp.id}.alolabs.net`);
  };

  const copyToClipboard = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error("Could not copy automatically — select text to copy");
    }
  };

  const handleGeneratePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setArchitecting(true);
    try {
      const manifestFiles =
        manifestJson.trim().length > 0
          ? { [manifestFilename.trim() || "package.json"]: manifestJson }
          : undefined;

      const res = await fetch("/api/ai/auto-deploy", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "architect",
          prompt: prompt.trim() || undefined,
          blueprintId: selectedBlueprintId || undefined,
          appName: appName.trim() || undefined,
          domain: domain.trim() || undefined,
          repository: repository.trim() || undefined,
          branch: branch.trim() || "main",
          manifestFiles,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.message || "Could not generate deployment plan");
      }
      const nextPlan: ArchitectPlan = body.data.plan;
      setPlan(nextPlan);
      setAppName(nextPlan.appName);
      setDomain(nextPlan.domain);
      setSslAutoIssue(nextPlan.sslAutoIssue);
      setAutoDeployOnPush(nextPlan.autoDeployOnPush);
      toast.success(`AI Deploy Plan ready (${nextPlan.workloadCategory.toUpperCase()} · ${nextPlan.framework})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate AI plan");
    } finally {
      setArchitecting(false);
    }
  };

  const handleProvision = async () => {
    if (!plan) return;
    setProvisioning(true);
    try {
      const autoSecrets = plan.requiredEnvKeys
        .filter((item) => item.autoGenerate && !envValues[item.key]?.trim())
        .map((item) => item.key);

      const res = await fetch("/api/ai/auto-deploy", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "provision",
          appName: appName.trim() || plan.appName,
          domain: domain.trim() || plan.domain,
          repository: repository.trim() || plan.repository,
          branch: branch.trim() || plan.branch,
          workloadCategory: plan.workloadCategory,
          framework: plan.framework,
          runtime: plan.runtime,
          websiteRuntime: plan.websiteRuntime,
          deployConfig: plan.deployConfig,
          envVars: envValues,
          autoGenerateSecretsFor: autoSecrets,
          autoDeployOnPush,
          sslAutoIssue,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.message || "Provisioning failed");
      }
      toast.success(body.message || "Zero-terminal project provisioned and queued for deployment!");
      setPlan(null);
      setEnvValues({});
      setAppName("");
      setDomain("");
      setRepository("");
      await loadStudio();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Provisioning failed");
    } finally {
      setProvisioning(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge className="bg-[#E8501A] text-white">AI-Driven Control Plane</Badge>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Zero-Terminal Auto-Deploy
            </Badge>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-2">
            AI Auto-Deploy Studio (Web, Server & Mobile Apps)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            No manual SSH or repetitive server setup — let AI detect your stack, configure build/runtime/SSL/secrets, and auto-deploy Server APIs, Web Apps, and Mobile Apps directly from one dashboard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadStudio()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh Status
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/deployments">
              <GitBranch className="h-4 w-4 mr-1.5" /> Git Release Queue
            </Link>
          </Button>
        </div>
      </div>

      {/* Live AI Automation Server Verification Bar */}
      {serverInfo && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase">AI Provider Failover</span>
                <Bot className="h-4 w-4 text-[#E8501A]" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{serverInfo.activeProviders.length}</span>
                <span className="text-xs text-emerald-600 font-medium">
                  {serverInfo.aiProviderChainReady ? "Active in chain" : "Fallback mode"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {serverInfo.activeProviders.map((p) => p.label).join(" → ") || "Deterministic blueprint mode"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase">AI Agents & Tools</span>
                <Sparkles className="h-4 w-4 text-violet-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{serverInfo.seededAiAgents}</span>
                <span className="text-xs text-muted-foreground">
                  agents · {serverInfo.scopedHostingTools.length} scoped tools
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {serverInfo.selfHostedAgentCatalogCount} self-hosted AI runtimes audited
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase">Managed Apps</span>
                <Layers className="h-4 w-4 text-sky-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold">{projects.length}</span>
                <span className="text-xs text-muted-foreground">
                  ({serverInfo.pendingOperations} queued ops)
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Web + Server API + Mobile OTA/Web bundles
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase">Ubuntu CIS Security</span>
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold">
                  {serverInfo.cisBaseline?.summary.passed ?? 0} PASS
                </span>
                <span className="text-xs text-muted-foreground">
                  / {serverInfo.cisBaseline?.summary.warnings ?? 0} warn
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                MIT UBUNTU22-CIS + argv-only execution
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Production Node Spec & Live Port Registry (alo-server-lap @ 103.231.239.79) */}
      {serverEnv && (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="h-4 w-4 text-[#E8501A]" />
                  Target Node: {serverEnv.spec.hostName} ({serverEnv.spec.publicIp})
                </CardTitle>
                <Badge variant="secondary" className="font-mono text-xs">
                  Next Port: {serverEnv.nextAvailablePort}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {serverEnv.spec.os} · Node {serverEnv.spec.nodeVersion} · {serverEnv.spec.processManager} · {serverEnv.spec.reverseProxy}
                </Badge>
              </div>
              <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                {serverEnv.spec.cdnDns} · {serverEnv.spec.sslStatus}
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto rounded-lg border text-xs">
              <table className="w-full text-left">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Domain</th>
                    <th className="px-3 py-2 font-medium">PM2 App</th>
                    <th className="px-3 py-2 font-medium">Port</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y font-mono">
                  {serverEnv.portRegistry.map((row) => (
                    <tr key={`${row.domain}-${row.port}`}>
                      <td className="px-3 py-2">{row.domain}</td>
                      <td className="px-3 py-2">{row.pm2App}</td>
                      <td className="px-3 py-2 font-semibold">{row.port}</td>
                      <td className="px-3 py-2 font-sans">
                        {row.role === "control-plane" ? (
                          <Badge variant="outline" className="text-[11px] border-[#E8501A]/40 text-[#E8501A]">
                            Control Plane (Reserved)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[11px]">Tenant App</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 font-sans">
                        <span className="text-emerald-600 font-medium">{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Select Workload Blueprint (Web / Server / Mobile) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-lg">1. Choose Workload Type or Blueprint</CardTitle>
              <CardDescription>
                Select a preset for Web Apps, Server-Side APIs, or Mobile Apps — or describe your custom stack below.
              </CardDescription>
            </div>
            <Tabs value={filterCategory} onValueChange={(v) => setFilterCategory(v as "all" | WorkloadCategory)}>
              <TabsList>
                <TabsTrigger value="all">All ({blueprints.length})</TabsTrigger>
                <TabsTrigger value="web">Web Apps</TabsTrigger>
                <TabsTrigger value="server">Server Apps</TabsTrigger>
                <TabsTrigger value="mobile">Mobile Apps</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {filteredBlueprints.map((bp) => {
              const selected = selectedBlueprintId === bp.id;
              return (
                <button
                  key={bp.id}
                  type="button"
                  onClick={() => handleSelectBlueprint(bp)}
                  className={`text-left rounded-xl border p-4 transition-all ${
                    selected
                      ? "border-[#E8501A] bg-[#E8501A]/5 ring-1 ring-[#E8501A]"
                      : "border-border hover:border-slate-400 bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <CategoryBadge category={bp.workloadCategory} />
                    <span className="text-xs font-mono text-muted-foreground">{bp.framework}</span>
                  </div>
                  <div className="font-semibold text-sm">{bp.name}</div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{bp.summary}</p>
                  <div className="flex flex-wrap gap-1 mt-2.5">
                    {bp.highlights.map((h) => (
                      <span
                        key={h}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Step 2: AI Setup Architect Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#E8501A]" />
              2. AI Setup & Auto-Deploy Architect
            </CardTitle>
            <CardDescription>
              Describe your project in Bengali or English, link a GitHub repository (`owner/repo`), or paste a manifest (`package.json`, `pubspec.yaml`, `requirements.txt`, `go.mod`).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGeneratePlan} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ai-prompt">Natural-Language Goal (বাংলা বা English)</Label>
                <Textarea
                  id="ai-prompt"
                  rows={3}
                  placeholder="যেমন: আমার একটি Expo React Native মোবাইল অ্যাপ এবং Node.js API সার্ভার স্বয়ংক্রিয়ভাবে SSL ও GitHub auto-deploy সহ সেটআপ করুন..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="app-name">Application Name</Label>
                  <Input
                    id="app-name"
                    placeholder="alo-crm-mobile"
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="app-domain">Target Domain</Label>
                  <Input
                    id="app-domain"
                    placeholder="mobile.hosting.alolabs.net"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="git-repo">GitHub Repository (optional `owner/repo`)</Label>
                  <Input
                    id="git-repo"
                    placeholder="aloeducation-org-crm/mobile-client"
                    value={repository}
                    onChange={(e) => setRepository(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="git-branch">Branch</Label>
                  <Input
                    id="git-branch"
                    placeholder="main"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="manifest-content">Optional Manifest Auto-Detection</Label>
                  <Input
                    aria-label="Manifest filename"
                    className="h-7 w-40 text-xs font-mono"
                    value={manifestFilename}
                    onChange={(e) => setManifestFilename(e.target.value)}
                  />
                </div>
                <Textarea
                  id="manifest-content"
                  rows={3}
                  className="font-mono text-xs"
                  placeholder='Paste package.json, pubspec.yaml, requirements.txt, or go.mod here for instant zero-guess detection...'
                  value={manifestJson}
                  onChange={(e) => setManifestJson(e.target.value)}
                />
              </div>

              <Button
                type="submit"
                disabled={architecting}
                className="w-full bg-[#E8501A] hover:bg-[#d14413] text-white"
              >
                {architecting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing Stack & Generating Plan...
                  </>
                ) : (
                  <>
                    <Cpu className="h-4 w-4 mr-2" /> Generate AI Zero-Terminal Deploy Plan
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Step 3: Review & 1-Click Provision */}
        <Card className="lg:col-span-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Rocket className="h-5 w-5 text-emerald-600" />
              3. Review Blueprint & 1-Click Auto-Deploy
            </CardTitle>
            <CardDescription>
              Every command is argv-allowlisted (zero shell injection), secrets are AES-256-GCM encrypted at rest, and failed releases auto-rollback.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!plan ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground space-y-2">
                <Code2 className="h-8 w-8 mx-auto opacity-50" />
                <p className="text-sm font-medium">No active deployment blueprint generated yet</p>
                <p className="text-xs">
                  Pick a Web, Server, or Mobile blueprint and click &ldquo;Generate AI Zero-Terminal Deploy Plan&rdquo; to preview the automated setup.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 p-3">
                  <div className="flex items-center gap-2">
                    <CategoryBadge category={plan.workloadCategory} />
                    <Badge variant="secondary" className="font-mono">{plan.framework}</Badge>
                    <Badge variant="outline" className="font-mono">Port :{plan.deployConfig.port}</Badge>
                  </div>
                  <Tabs value={reviewTab} onValueChange={(v) => setReviewTab(v as "plan" | "brief" | "nginx")}>
                    <TabsList className="h-8">
                      <TabsTrigger value="plan" className="text-xs px-2.5">Deploy Plan</TabsTrigger>
                      <TabsTrigger value="brief" className="text-xs px-2.5">Project Brief YAML</TabsTrigger>
                      <TabsTrigger value="nginx" className="text-xs px-2.5">Nginx & DNS</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                {reviewTab === "brief" && plan.shareableBriefYaml && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" /> Shareable Developer / Client Brief (YAML)
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => void copyToClipboard("Project Brief YAML", plan.shareableBriefYaml!)}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1" /> Copy YAML
                      </Button>
                    </div>
                    <pre className="text-xs font-mono bg-slate-950 text-slate-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                      {plan.shareableBriefYaml}
                    </pre>
                  </div>
                )}

                {reviewTab === "nginx" && (
                  <div className="space-y-3">
                    {plan.cloudflareDnsRecord && (
                      <div className="rounded-lg border p-2.5 text-xs space-y-1">
                        <div className="font-semibold">Cloudflare DNS Record (Proxied)</div>
                        <div className="font-mono text-muted-foreground">
                          Type: {plan.cloudflareDnsRecord.type} · Name: {plan.cloudflareDnsRecord.name} →{" "}
                          {plan.cloudflareDnsRecord.content} (Proxied)
                        </div>
                      </div>
                    )}
                    {plan.nginxConfig && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">
                            /etc/nginx/sites-available/{plan.domain}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => void copyToClipboard("Nginx Config", plan.nginxConfig!)}
                          >
                            <Copy className="h-3.5 w-3.5 mr-1" /> Copy Nginx
                          </Button>
                        </div>
                        <pre className="text-[11px] font-mono bg-slate-950 text-slate-100 rounded-lg p-3 max-h-48 overflow-auto">
                          {plan.nginxConfig}
                        </pre>
                      </div>
                    )}
                    {plan.cliDeployCommand && (
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-muted p-2.5 text-xs font-mono">
                        <span className="truncate flex items-center gap-1.5">
                          <Terminal className="h-3.5 w-3.5 shrink-0" /> {plan.cliDeployCommand}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs shrink-0"
                          onClick={() => void copyToClipboard("CLI Deploy Command", plan.cliDeployCommand!)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {reviewTab === "plan" && (
                  <>
                <p className="text-xs leading-relaxed bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                  {plan.aiSummary}
                </p>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-950 text-slate-100 rounded-lg p-3">
                  <div>
                    <span className="text-slate-400">install:</span> {plan.deployConfig.installCmd ?? "none"}
                  </div>
                  <div>
                    <span className="text-slate-400">service:</span> {plan.deployConfig.serviceManager}
                  </div>
                  <div>
                    <span className="text-slate-400">build:</span> {plan.deployConfig.buildCmd ?? "none"}
                  </div>
                  <div>
                    <span className="text-slate-400">output:</span> {plan.deployConfig.outputDir}
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400">start:</span> {plan.deployConfig.startCmd ?? "static / web-server"} ·{" "}
                    <span className="text-slate-400">health:</span> {plan.deployConfig.healthPath}
                  </div>
                </div>

                {/* Environment Variables & Auto-Secret Vault */}
                {plan.requiredEnvKeys.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Encrypted Environment Vault
                    </Label>
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {plan.requiredEnvKeys.map((envSpec) => (
                        <div key={envSpec.key} className="grid grid-cols-12 gap-2 items-center">
                          <span className="col-span-5 text-xs font-mono truncate" title={envSpec.description}>
                            {envSpec.key}
                          </span>
                          <Input
                            type={envSpec.secret ? "password" : "text"}
                            className="col-span-7 h-8 text-xs"
                            placeholder={
                              envSpec.autoGenerate
                                ? "Auto-generates 256-bit CSPRNG secret if blank"
                                : envSpec.description
                            }
                            value={envValues[envSpec.key] ?? ""}
                            onChange={(e) =>
                              setEnvValues((prev) => ({ ...prev, [envSpec.key]: e.target.value }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                  <div className="flex items-center gap-2">
                    <Switch checked={sslAutoIssue} onCheckedChange={setSslAutoIssue} id="auto-ssl" />
                    <Label htmlFor="auto-ssl" className="text-xs">Auto Let&apos;s Encrypt SSL</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={autoDeployOnPush} onCheckedChange={setAutoDeployOnPush} id="auto-push" />
                    <Label htmlFor="auto-push" className="text-xs">Auto-Deploy on Git Push</Label>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  {plan.steps.map((s) => (
                    <div key={s} className="flex items-start gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
                  </>
                )}

                <Button
                  type="button"
                  onClick={() => void handleProvision()}
                  disabled={provisioning}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {provisioning ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Provisioning Workspace & Queuing Deploy...
                    </>
                  ) : (
                    <>
                      <Rocket className="h-4 w-4 mr-2" /> 1-Click Provision & Queue Auto-Deploy
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Managed Web, Server & Mobile Projects Control Plane */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-[#E8501A]" />
            Managed Applications ({projects.length})
          </CardTitle>
          <CardDescription>
            Unified Hostinger/Render-style control plane across your Server-Side APIs, Web Applications, and Mobile Apps.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No applications provisioned yet. Use the AI Setup Architect above to launch your first Web, Server, or Mobile app without touching the terminal.
            </div>
          ) : (
            <div className="divide-y">
              {projects.map((proj) => (
                <div
                  key={proj.websiteId}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">{proj.name}</span>
                      <CategoryBadge category={proj.workloadCategory} />
                      <Badge variant="secondary" className="font-mono text-xs">{proj.framework}</Badge>
                      <Badge variant="outline" className="text-xs">{proj.status}</Badge>
                      {proj.sslEnabled && (
                        <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-500/30">
                          HTTPS
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3">
                      <span className="font-mono">{proj.domain}</span>
                      <span>Health: {proj.healthPath}</span>
                      {proj.gitProject && (
                        <span className="font-mono">
                          Git: {proj.gitProject.repository}@{proj.gitProject.productionBranch} (
                          {proj.gitProject.autoDeploy ? "Auto-Deploy ON" : "Manual"})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/sites/${proj.websiteId}`}>
                        Manage <ExternalLink className="h-3.5 w-3.5 ml-1" />
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href="/deployments">Deployments</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
