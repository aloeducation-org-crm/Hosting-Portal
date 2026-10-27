"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  Cloud,
  Cpu,
  Database,
  ExternalLink,
  FolderGit2,
  FolderTree,
  Globe,
  HardDrive,
  HeartPulse,
  Layers,
  Loader2,
  Lock,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

type StackPresetId =
  | "nextjs-app"
  | "nodejs-api"
  | "python-app"
  | "static-spa"
  | "php-cms"
  | "flowise-agent"
  | "langflow-agent"
  | "langgraph-agent"
  | "crewai-service"
  | "agno-agent"
  | "letta-memory";

interface StackPreset {
  id: StackPresetId;
  category?: "web-app" | "self-hosted-agent";
  label: string;
  tagline: string;
  websiteRuntime: "NEXTJS" | "NODE" | "STATIC" | "PHP82";
  runtimeVersion: string;
  pinnedVersion?: string;
  licenseNote?: string;
  defaultBuildCommand: string;
  defaultStartCommand: string;
  defaultOutputDirectory: string;
  defaultHealthPath: string;
  recommendedDb: "POSTGRESQL" | "MARIADB" | "NONE";
}

interface SelfHostedAgentItem {
  id: string;
  name: string;
  category: string;
  license: string;
  licenseTriage?: string;
  decision?: string;
  latestVerifiedVersion?: string | null;
  commercialMultiTenantSafe: boolean;
  licenseGuardrail: string;
  executionSurface: string;
  stateBacking: string;
  defaultPort: number | null;
  securityRequirement: string;
  deployPresetId: StackPresetId | null;
  bestFor: string;
}

interface HardwareProfileItem {
  id: string;
  label: string;
  quantization: string;
  minVramGb: number;
  estimatedMaxVramGb?: number;
  minSystemRamGb: number;
  minDiskGb?: number;
  contextWindow: string;
  recommendedHardware: string;
  exampleModels: string;
}

interface BenchmarkItem {
  provider: string;
  url: string;
  capability: string;
  aloEquivalent: string;
}

interface DeployBlueprint {
  projectName: string;
  workspaceName: string;
  stackId: StackPresetId;
  domain: string;
  gitRepo: string;
  gitBranch: string;
  buildCommand: string;
  startCommand: string;
  outputDirectory: string;
  autoSsl: boolean;
  securityProfile: "standard" | "strict-waf";
  database: {
    enabled: boolean;
    engine: "POSTGRESQL" | "MARIADB";
    name: string;
  };
  resources: {
    tier: "starter" | "growth" | "performance";
    cpuCores: number;
    memoryMb: number;
    storageGb: number;
    edgeCache: boolean;
    compression: boolean;
  };
  backups: {
    enabled: boolean;
    frequency: "daily" | "weekly" | "every-6h";
  };
  selfHealing: {
    enabled: boolean;
    healthPath: string;
    autoRollback: boolean;
  };
  envVars: Array<{ key: string; value: string }>;
}

interface RecentSite {
  id: string;
  name: string | null;
  domain: string;
  runtime: string;
  status: string;
  applicationPort: number | null;
  documentRoot: string | null;
  healthStatus: string | null;
  organization: { name: string; slug: string } | null;
  domains: Array<{ domain: string; sslEnabled: boolean; sslStatus: string }>;
  applications: Array<{ id: string; name: string; type: string; runtime: string | null }>;
  cronJobs: Array<{ id: string; name: string; schedule: string; isActive: boolean }>;
}

interface ProvisionResult {
  website: {
    id: string;
    name: string | null;
    domain: string;
    runtime: string;
    documentRoot: string | null;
    port: number | null;
    status: string;
    healthStatus?: string | null;
  };
  workspace: { name: string; slug: string } | null;
  domain: { domain: string; sslEnabled: boolean; sslStatus: string } | null;
  database: { engine: string; name: string; port: number } | null;
  backups: { schedule: string; frequency: string } | null;
  selfHealing: { enabled: boolean; healthPath: string; autoRollback: boolean };
  readiness?: {
    state: "LIVE_HEALTHY" | "CONFIGURED_AWAITING_RELEASE";
    reachable: boolean;
    httpStatus: number | null;
    checkedUrl: string | null;
    note: string;
  };
}

const EXAMPLE_PROMPTS = [
  "Deploy a Python FastAPI student portal under ALO Education workspace with PostgreSQL, daily backups, and strict WAF security",
  "Launch a Next.js 16 CRM dashboard on crm-portal.apps.alolabs.net with Postgres database, auto-SSL, and self-healing rollback",
  "Create a Node.js API service with isolated PostgreSQL database, performance resource tier, and backups every 6 hours",
  "Publish a React Vite static marketing site with global edge caching, compression, and free SSL",
];

const TIER_SPECS = {
  starter: { label: "Starter", cpuCores: 1, memoryMb: 1024, storageGb: 10 },
  growth: { label: "Growth", cpuCores: 2, memoryMb: 2048, storageGb: 25 },
  performance: { label: "Performance", cpuCores: 4, memoryMb: 8192, storageGb: 80 },
} as const;

const INITIAL_BLUEPRINT: DeployBlueprint = {
  projectName: "ALO Portal App",
  workspaceName: "ALO Labs Workspace",
  stackId: "nextjs-app",
  domain: "alo-portal-app.apps.alolabs.net",
  gitRepo: "",
  gitBranch: "main",
  buildCommand: "npm run build",
  startCommand: "npm start",
  outputDirectory: ".next",
  autoSsl: true,
  securityProfile: "strict-waf",
  database: {
    enabled: true,
    engine: "POSTGRESQL",
    name: "alo_portal_app_db",
  },
  resources: {
    tier: "growth",
    cpuCores: 2,
    memoryMb: 2048,
    storageGb: 25,
    edgeCache: true,
    compression: true,
  },
  backups: {
    enabled: true,
    frequency: "daily",
  },
  selfHealing: {
    enabled: true,
    healthPath: "/api/health",
    autoRollback: true,
  },
  envVars: [],
};

function toSlug(value: string, fallback = "my-app"): string {
  const s = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return s.length >= 2 ? s : fallback;
}

export default function ZeroTerminalDeployAssistant() {
  const [presets, setPresets] = useState<StackPreset[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchmarkItem[]>([]);
  const [selfHostedAgents, setSelfHostedAgents] = useState<SelfHostedAgentItem[]>([]);
  const [hardwareProfiles, setHardwareProfiles] = useState<HardwareProfileItem[]>([]);
  const [selectedHardwareScale, setSelectedHardwareScale] = useState<string>("orchestration-only");
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [recentSites, setRecentSites] = useState<RecentSite[]>([]);
  const [activeProvider, setActiveProvider] = useState<{ label: string; model: string } | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);

  const [prompt, setPrompt] = useState("");
  const [planning, setPlanning] = useState(false);
  const [planMeta, setPlanMeta] = useState<{
    source: "ai" | "preset";
    providerLabel?: string;
    model?: string;
    summary: string;
    highlights: string[];
  } | null>(null);

  const [blueprint, setBlueprint] = useState<DeployBlueprint>(INITIAL_BLUEPRINT);
  const [domainManuallyEdited, setDomainManuallyEdited] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState<ProvisionResult | null>(null);
  const [showBenchmarks, setShowBenchmarks] = useState(false);
  const [showSelfHostedMatrix, setShowSelfHostedMatrix] = useState(false);

  const applyContextData = useCallback((data: Record<string, unknown>) => {
    setPresets((data.presets as StackPreset[]) ?? []);
    setBenchmarks((data.benchmarks as BenchmarkItem[]) ?? []);
    setSelfHostedAgents((data.selfHostedAgents as SelfHostedAgentItem[]) ?? []);
    setHardwareProfiles((data.hardwareProfiles as HardwareProfileItem[]) ?? []);
    setWorkspaces((data.workspaces as Array<{ id: string; name: string; slug: string }>) ?? []);
    setRecentSites((data.recentSites as RecentSite[]) ?? []);
    const provider = data.activeProvider as { label: string; model: string } | null | undefined;
    if (provider) {
      setActiveProvider({ label: provider.label, model: provider.model });
    }
  }, []);

  const loadContext = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/deploy-assistant", { credentials: "include" });
      const json = await res.json();
      if (res.ok && json?.data) {
        applyContextData(json.data);
      }
    } catch {
      // Keep interactive defaults if offline
    } finally {
      setLoadingInit(false);
    }
  }, [applyContextData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai/deploy-assistant", { credentials: "include" });
        const json = await res.json();
        if (!cancelled && res.ok && json?.data) {
          applyContextData(json.data);
        }
      } catch {
        // Keep interactive defaults if offline
      } finally {
        if (!cancelled) setLoadingInit(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyContextData]);

  const workspaceSlug = useMemo(
    () => toSlug(blueprint.workspaceName, "workspace"),
    [blueprint.workspaceName],
  );

  const handleSelectPreset = async (stackId: StackPresetId) => {
    setErrorMessage(null);
    setProvisioned(null);
    try {
      const res = await fetch("/api/ai/deploy-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "preset",
          stackId,
          projectName: blueprint.projectName,
          workspaceName: blueprint.workspaceName,
          domain: domainManuallyEdited ? blueprint.domain : undefined,
          gitRepo: blueprint.gitRepo,
          tier: blueprint.resources.tier,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMessage(json?.error?.message ?? json?.message ?? "Could not load stack preset");
        return;
      }
      setBlueprint(json.data.blueprint);
      setPlanMeta({
        source: "preset",
        summary: json.data.summary,
        highlights: json.data.highlights ?? [],
      });
    } catch {
      setErrorMessage("Network error while loading stack preset");
    }
  };

  const handlePlanWithAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || planning) return;
    setPlanning(true);
    setErrorMessage(null);
    setProvisioned(null);

    try {
      const res = await fetch("/api/ai/deploy-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "plan", prompt: prompt.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMessage(
          `${json?.error?.message ?? json?.message ?? "AI planning failed"}. You can still select any 1-Click Stack Preset below and deploy visually right away.`,
        );
        return;
      }
      setBlueprint(json.data.blueprint);
      setDomainManuallyEdited(true);
      setPlanMeta({
        source: "ai",
        providerLabel: json.data.providerLabel,
        model: json.data.model,
        summary: json.data.summary,
        highlights: json.data.highlights ?? [],
      });
    } catch {
      setErrorMessage("Could not contact the AI planner endpoint. Use any 1-Click Stack Preset below to continue.");
    } finally {
      setPlanning(false);
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setErrorMessage(null);
    setProvisioned(null);
    try {
      const res = await fetch("/api/ai/deploy-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "deploy", blueprint }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMessage(json?.error?.message ?? json?.message ?? "Visual deployment failed");
        return;
      }
      setProvisioned(json.data as ProvisionResult);
      await loadContext();
    } catch {
      setErrorMessage("Network error while provisioning project");
    } finally {
      setDeploying(false);
    }
  };

  const handleProjectNameChange = (value: string) => {
    const slug = toSlug(value, "my-app");
    setBlueprint((prev) => ({
      ...prev,
      projectName: value,
      domain: domainManuallyEdited ? prev.domain : `${slug}.apps.alolabs.net`,
      database: {
        ...prev.database,
        name: `${slug.replace(/-/g, "_")}_db`.slice(0, 46),
      },
    }));
  };

  const handleTierChange = (tier: "starter" | "growth" | "performance") => {
    const spec = TIER_SPECS[tier];
    setBlueprint((prev) => ({
      ...prev,
      resources: {
        ...prev.resources,
        tier,
        cpuCores: spec.cpuCores,
        memoryMb: spec.memoryMb,
        storageGb: spec.storageGb,
      },
    }));
  };

  const addEnvVar = () => {
    setBlueprint((prev) => ({
      ...prev,
      envVars: [...prev.envVars, { key: "APP_MODE", value: "production" }],
    }));
  };

  const updateEnvVar = (index: number, field: "key" | "value", value: string) => {
    setBlueprint((prev) => ({
      ...prev,
      envVars: prev.envVars.map((row, idx) =>
        idx === index
          ? {
              ...row,
              [field]: field === "key" ? value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") : value,
            }
          : row,
      ),
    }));
  };

  const removeEnvVar = (index: number) => {
    setBlueprint((prev) => ({
      ...prev,
      envVars: prev.envVars.filter((_, idx) => idx !== index),
    }));
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header Banner */}
      <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-br from-indigo-600 via-violet-600 to-cyan-600 p-6 text-white shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5" />
              Zero-Terminal Visual Hosting Copilot • hosting.alolabs.net
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Deploy Projects Visually — Zero Terminal Coding Required
            </h1>
            <p className="text-sm sm:text-base text-indigo-100 max-w-3xl">
              Describe your project in plain English or pick a 1-click Node.js, Next.js, Python, PHP, or
              Static stack. Configure workspaces, domains, free SSL, isolated databases, backups, and
              self-healing health checks with point-and-click controls.
            </p>
          </div>
          <div className="flex flex-col items-start lg:items-end gap-2 shrink-0">
            <div className="rounded-xl bg-black/25 px-3.5 py-2 text-xs backdrop-blur-sm border border-white/15">
              <div className="font-semibold flex items-center gap-1.5">
                <Bot className="h-4 w-4 text-cyan-300" />
                {activeProvider
                  ? `AI Engine: ${activeProvider.label} (${activeProvider.model})`
                  : "1-Click Visual Preset Mode Ready"}
              </div>
              <div className="text-indigo-100/80 mt-0.5">
                Human-confirmed provisioning • Full RBAC & audit trail
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setShowSelfHostedMatrix((v) => !v)}
                className="text-xs underline underline-offset-4 text-cyan-200 hover:text-white font-medium"
              >
                {showSelfHostedMatrix
                  ? "Hide 12 Self-Hosted AI Agents & VRAM Sizer"
                  : "Explore 12 Self-Hosted AI Agents & VRAM Sizer"}
              </button>
              <button
                type="button"
                onClick={() => setShowBenchmarks((v) => !v)}
                className="text-xs underline underline-offset-4 text-indigo-100 hover:text-white"
              >
                {showBenchmarks
                  ? "Hide 10 VPS Control-Panel Benchmarks"
                  : "View 10 VPS Control-Panel Benchmarks"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible Self-Hosted Open-Source AI Agent Matrix & Hardware VRAM Sizer */}
      {showSelfHostedMatrix && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Self-Hosted Open-Source AI Agent Catalog & GPU / VRAM Hardware Sizer
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Keep PII, student records, and CRM credentials on your own ALO servers with Ollama, LocalAI, LiteLLM, and GLM-5.
              </p>
            </div>
            {hardwareProfiles.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 shrink-0">
                  Target Model Scale:
                </label>
                <select
                  value={selectedHardwareScale}
                  onChange={(e) => setSelectedHardwareScale(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-medium"
                >
                  {hardwareProfiles.map((hp) => (
                    <option key={hp.id} value={hp.id}>
                      {hp.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {hardwareProfiles.length > 0 && (() => {
            const activeHp =
              hardwareProfiles.find((h) => h.id === selectedHardwareScale) ?? hardwareProfiles[0]!;
            return (
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30 p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-slate-500">Quantization & Context</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {activeHp.quantization} • {activeHp.contextWindow}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Estimated VRAM Range / Host RAM</div>
                  <div className="font-semibold text-indigo-700 dark:text-indigo-300 mt-0.5">
                    {activeHp.minVramGb > 0
                      ? `Est. ${activeHp.minVramGb}–${activeHp.estimatedMaxVramGb ?? activeHp.minVramGb} GB VRAM`
                      : "0 GB VRAM (CPU Orchestration)"} •{" "}
                    {activeHp.minSystemRamGb} GB RAM
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-slate-500">Recommended Server Hardware ({activeHp.exampleModels})</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {activeHp.recommendedHardware}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {selfHostedAgents.map((agent) => (
              <div
                key={agent.id}
                className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 text-xs bg-slate-50/70 dark:bg-slate-950/50 flex flex-col justify-between gap-2"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{agent.name}</span>
                    <div className="flex items-center gap-1">
                      {agent.decision && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            agent.decision === "REJECT"
                              ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                              : agent.decision === "INTERNAL_ONLY" || agent.decision === "DEFER"
                              ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                              : "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                          }`}
                        >
                          {agent.decision}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          agent.commercialMultiTenantSafe
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                        }`}
                      >
                        {agent.commercialMultiTenantSafe ? agent.license : (agent.licenseTriage ?? "Review License")}
                      </span>
                    </div>
                  </div>
                  <div className="text-slate-600 dark:text-slate-300">{agent.bestFor}</div>
                  <div className="text-[11px] text-slate-500">
                    <strong>State:</strong> {agent.stateBacking}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    <strong>License & Safety:</strong> {agent.licenseGuardrail} {agent.securityRequirement}
                  </div>
                </div>
                {agent.deployPresetId && (
                  <button
                    type="button"
                    onClick={() => void handleSelectPreset(agent.deployPresetId!)}
                    className="mt-1 inline-flex items-center justify-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors"
                  >
                    <Rocket className="h-3 w-3" />
                    Load 1-Click {agent.name} Blueprint
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible 10-Provider Capability Matrix */}
      {showBenchmarks && benchmarks.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                10 Managed Visual VPS Capabilities Unified in ALO Labs Hosting
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Every zero-terminal workflow from leading managed hosting panels is wired into the controls below.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {benchmarks.map((b) => (
              <div
                key={b.provider}
                className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs bg-slate-50/70 dark:bg-slate-950/50"
              >
                <div className="font-semibold text-indigo-600 dark:text-indigo-400">{b.provider}</div>
                <div className="text-slate-600 dark:text-slate-400 mt-0.5">{b.capability}</div>
                <div className="text-slate-900 dark:text-slate-200 mt-1 font-medium">
                  → ALO Labs: {b.aloEquivalent}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Natural-Language AI Planner */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Step 1 — Ask the Built-In AI Assistant (or Pick a 1-Click Stack Below)
          </h2>
        </div>

        <form onSubmit={handlePlanWithAI} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Deploy a Python FastAPI portal for ALO Education with PostgreSQL, auto-SSL, and daily backups..."
              className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={planning || !prompt.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-white transition-colors shrink-0"
            >
              {planning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating Plan…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Configure with AI
                </>
              )}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setPrompt(sample)}
                className="rounded-full border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-indigo-400 px-3 py-1 text-xs text-slate-600 dark:text-slate-300 transition-colors text-left"
              >
                {sample.slice(0, 74)}…
              </button>
            ))}
          </div>
        </form>

        {planMeta && (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/70 dark:bg-indigo-950/30 p-4 text-sm space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-indigo-950 dark:text-indigo-200">
                {planMeta.source === "ai"
                  ? `AI Deployment Plan (${planMeta.providerLabel ?? "AI"} • ${planMeta.model ?? ""})`
                  : "1-Click Stack Blueprint Loaded"}
              </span>
              <span className="text-xs rounded-full bg-indigo-600/10 text-indigo-700 dark:text-indigo-300 px-2.5 py-0.5 font-medium">
                Review & customize visually below
              </span>
            </div>
            <p className="text-slate-700 dark:text-slate-300 text-xs sm:text-sm">{planMeta.summary}</p>
            {planMeta.highlights.length > 0 && (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 text-xs text-slate-600 dark:text-slate-300">
                {planMeta.highlights.map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 1-Click Stack Installer Selector (A2 Hosting / InterServer style) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Step 2 — 1-Click Environment Installer
            </h2>
          </div>
          <span className="text-xs text-slate-500">
            Web Apps (Next.js • Node • Python • Static • PHP) + Self-Hosted AI Agents (Flowise • LangGraph • CrewAI • Letta)
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {(presets.length > 0
            ? presets
            : [
                {
                  id: "nextjs-app" as const,
                  label: "Next.js 16 Full-Stack App",
                  tagline: "SSR & App Router",
                  websiteRuntime: "NEXTJS" as const,
                  runtimeVersion: "node-22-nextjs-16",
                  defaultBuildCommand: "npm run build",
                  defaultStartCommand: "npm start",
                  defaultOutputDirectory: ".next",
                  defaultHealthPath: "/api/health",
                  recommendedDb: "POSTGRESQL" as const,
                },
                {
                  id: "nodejs-api" as const,
                  label: "Node.js 1-Click Environment",
                  tagline: "Express / Fastify / NestJS",
                  websiteRuntime: "NODE" as const,
                  runtimeVersion: "node-22-lts",
                  defaultBuildCommand: "npm ci",
                  defaultStartCommand: "npm start",
                  defaultOutputDirectory: "dist",
                  defaultHealthPath: "/health",
                  recommendedDb: "POSTGRESQL" as const,
                },
                {
                  id: "python-app" as const,
                  label: "Python 1-Click Environment",
                  tagline: "FastAPI / Django / Flask",
                  websiteRuntime: "NODE" as const,
                  runtimeVersion: "python-3.12",
                  defaultBuildCommand: "pip install -r requirements.txt",
                  defaultStartCommand: "uvicorn app.main:app --host 127.0.0.1",
                  defaultOutputDirectory: ".",
                  defaultHealthPath: "/health",
                  recommendedDb: "POSTGRESQL" as const,
                },
                {
                  id: "static-spa" as const,
                  label: "React / Vite Static Site",
                  tagline: "Global Edge CDN SPA",
                  websiteRuntime: "STATIC" as const,
                  runtimeVersion: "static-edge",
                  defaultBuildCommand: "npm run build",
                  defaultStartCommand: "",
                  defaultOutputDirectory: "dist",
                  defaultHealthPath: "/",
                  recommendedDb: "NONE" as const,
                },
                {
                  id: "php-cms" as const,
                  label: "PHP 8.2 / WordPress",
                  tagline: "Managed FastCGI + MariaDB",
                  websiteRuntime: "PHP82" as const,
                  runtimeVersion: "php-8.2-fpm",
                  defaultBuildCommand: "",
                  defaultStartCommand: "",
                  defaultOutputDirectory: "public",
                  defaultHealthPath: "/",
                  recommendedDb: "MARIADB" as const,
                },
              ]
          ).map((preset) => {
            const selected = blueprint.stackId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => void handleSelectPreset(preset.id)}
                className={`rounded-xl border p-3.5 text-left transition-all ${
                  selected
                    ? "border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/40 ring-2 ring-indigo-500/30"
                    : "border-slate-200 dark:border-slate-800 hover:border-indigo-400"
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  {preset.runtimeVersion}
                </div>
                <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 mt-1">
                  {preset.label}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                  {preset.tagline}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 3: 6-Card Visual Control Panel Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Card 1: Workspace & Folder Isolation */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <FolderTree className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Workspace & Multi-Project Folder Isolation
              </h3>
              <p className="text-xs text-slate-500">
                Organize company workspaces & isolated project roots under one roof
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Project Name
              </label>
              <input
                type="text"
                value={blueprint.projectName}
                onChange={(e) => handleProjectNameChange(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Company / Workspace Folder
              </label>
              <input
                type="text"
                list="alo-workspaces-list"
                value={blueprint.workspaceName}
                onChange={(e) =>
                  setBlueprint((prev) => ({ ...prev, workspaceName: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
              <datalist id="alo-workspaces-list">
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.name} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                GitHub Repository (optional — leave blank for zero-code site)
              </label>
              <div className="relative">
                <FolderGit2 className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={blueprint.gitRepo}
                  onChange={(e) =>
                    setBlueprint((prev) => ({ ...prev, gitRepo: e.target.value }))
                  }
                  placeholder="owner/repository"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Branch
              </label>
              <input
                type="text"
                value={blueprint.gitBranch}
                onChange={(e) =>
                  setBlueprint((prev) => ({ ...prev, gitBranch: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-600 dark:text-slate-400 font-mono truncate">
            Isolated Partition: /srv/alo-sites/{workspaceSlug}/{blueprint.domain}/current
          </div>
        </div>

        {/* Card 2: Domain, Free Auto-SSL & Security */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Domain, Free Global SSL & Built-In Security
              </h3>
              <p className="text-xs text-slate-500">
                Automatic subdomain or custom domain binding with zero-touch HTTPS & WAF
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Domain or Instant ALO Subdomain
            </label>
            <input
              type="text"
              value={blueprint.domain}
              onChange={(e) => {
                setDomainManuallyEdited(true);
                setBlueprint((prev) => ({ ...prev, domain: e.target.value.toLowerCase() }));
              }}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 dark:border-slate-800 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={blueprint.autoSsl}
                onChange={(e) =>
                  setBlueprint((prev) => ({ ...prev, autoSsl: e.target.checked }))
                }
                className="mt-0.5 rounded text-indigo-600"
              />
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                  <Lock className="h-3.5 w-3.5 text-emerald-500" />
                  1-Click Free Auto-SSL
                </div>
                <div className="text-[11px] text-slate-500">
                  Auto-renews Let&apos;s Encrypt / Cloudflare Edge TLS
                </div>
              </div>
            </label>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Multi-Tenant Security Profile
              </label>
              <select
                value={blueprint.securityProfile}
                onChange={(e) =>
                  setBlueprint((prev) => ({
                    ...prev,
                    securityProfile: e.target.value as "standard" | "strict-waf",
                  }))
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-medium"
              >
                <option value="strict-waf">Strict WAF + Tenant Isolation + HSTS</option>
                <option value="standard">Standard HTTPS + Rate Limiting</option>
              </select>
            </div>
          </div>
        </div>

        {/* Card 3: Zero-Coding Isolated Database */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Zero-Coding Isolated Database Configuration
                </h3>
                <p className="text-xs text-slate-500">
                  Dedicated per-project database blueprint wired into app environment automatically
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={blueprint.database.enabled}
              onChange={(e) =>
                setBlueprint((prev) => ({
                  ...prev,
                  database: { ...prev.database, enabled: e.target.checked },
                }))
              }
              className="h-4 w-4 rounded text-indigo-600"
            />
          </div>

          {blueprint.database.enabled ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Database Engine
                </label>
                <select
                  value={blueprint.database.engine}
                  onChange={(e) =>
                    setBlueprint((prev) => ({
                      ...prev,
                      database: {
                        ...prev.database,
                        engine: e.target.value as "POSTGRESQL" | "MARIADB",
                      },
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="POSTGRESQL">PostgreSQL 16 (Isolated)</option>
                  <option value="MARIADB">MariaDB 10.11 / MySQL Compatible</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Database Name
                </label>
                <input
                  type="text"
                  value={blueprint.database.name}
                  onChange={(e) =>
                    setBlueprint((prev) => ({
                      ...prev,
                      database: {
                        ...prev.database,
                        name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                      },
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="sm:col-span-2 rounded-lg bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
                Auto-wires <code className="font-mono">DB_ENGINE</code>,{" "}
                <code className="font-mono">DB_HOST=127.0.0.1</code>,{" "}
                <code className="font-mono">
                  DB_PORT={blueprint.database.engine === "POSTGRESQL" ? "5432" : "3306"}
                </code>{" "}
                & <code className="font-mono">DB_NAME={blueprint.database.name}</code> with zero SQL commands.
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3 text-xs text-slate-500">
              Stateless / static deployment — toggle on anytime to attach an isolated PostgreSQL or MariaDB database.
            </div>
          )}
        </div>

        {/* Card 4: Resource Partitioning & Performance Optimization */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Server Resource Partitioning & Speed Optimizations
              </h3>
              <p className="text-xs text-slate-500">
                Automated CPU/RAM allocation, edge caching & Brotli/Gzip compression
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(["starter", "growth", "performance"] as const).map((tierKey) => {
              const spec = TIER_SPECS[tierKey];
              const active = blueprint.resources.tier === tierKey;
              return (
                <button
                  key={tierKey}
                  type="button"
                  onClick={() => handleTierChange(tierKey)}
                  className={`rounded-lg border p-2.5 text-left transition-colors ${
                    active
                      ? "border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/40"
                      : "border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {spec.label}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {spec.cpuCores} vCPU • {spec.memoryMb / 1024} GB RAM
                  </div>
                  <div className="text-[11px] text-slate-400">{spec.storageGb} GB NVMe</div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={blueprint.resources.edgeCache}
                onChange={(e) =>
                  setBlueprint((prev) => ({
                    ...prev,
                    resources: { ...prev.resources, edgeCache: e.target.checked },
                  }))
                }
                className="rounded text-indigo-600"
              />
              Global Edge Static Caching
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={blueprint.resources.compression}
                onChange={(e) =>
                  setBlueprint((prev) => ({
                    ...prev,
                    resources: { ...prev.resources, compression: e.target.checked },
                  }))
                }
                className="rounded text-indigo-600"
              />
              Auto Brotli + Gzip Compression
            </label>
          </div>
        </div>

        {/* Card 5: Automated Backups & Self-Healing Rollback */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Automated Backups & Server Self-Healing
              </h3>
              <p className="text-xs text-slate-500">
                Scheduled snapshots plus continuous HTTP health verification & auto-rollback
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Automated Backup Schedule
              </label>
              <select
                value={blueprint.backups.enabled ? blueprint.backups.frequency : "off"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "off") {
                    setBlueprint((prev) => ({
                      ...prev,
                      backups: { ...prev.backups, enabled: false },
                    }));
                  } else {
                    setBlueprint((prev) => ({
                      ...prev,
                      backups: {
                        enabled: true,
                        frequency: v as "daily" | "weekly" | "every-6h",
                      },
                    }));
                  }
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-medium"
              >
                <option value="every-6h">Every 6 Hours (High-Traffic)</option>
                <option value="daily">Daily at 02:00 UTC (Recommended)</option>
                <option value="weekly">Weekly Snapshot</option>
                <option value="off">Manual Backups Only</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Health Check Endpoint
              </label>
              <input
                type="text"
                value={blueprint.selfHealing.healthPath}
                onChange={(e) =>
                  setBlueprint((prev) => ({
                    ...prev,
                    selfHealing: { ...prev.selfHealing, healthPath: e.target.value },
                  }))
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono"
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={blueprint.selfHealing.autoRollback}
              onChange={(e) =>
                setBlueprint((prev) => ({
                  ...prev,
                  selfHealing: { ...prev.selfHealing, autoRollback: e.target.checked },
                }))
              }
              className="rounded text-indigo-600"
            />
            Self-healing: automatically keep previous healthy release live if health check fails
          </label>
        </div>

        {/* Card 6: Visual Runtime Commands & Environment Variables */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Visual Build Pipeline & Environment Variables
                </h3>
                <p className="text-xs text-slate-500">
                  Pre-filled from your selected stack — customize visually without SSH
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={addEnvVar}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-xs font-medium hover:border-indigo-500"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Env
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Build Command
              </label>
              <input
                type="text"
                value={blueprint.buildCommand}
                onChange={(e) =>
                  setBlueprint((prev) => ({ ...prev, buildCommand: e.target.value }))
                }
                placeholder="(none required)"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Start Command
              </label>
              <input
                type="text"
                value={blueprint.startCommand}
                onChange={(e) =>
                  setBlueprint((prev) => ({ ...prev, startCommand: e.target.value }))
                }
                placeholder="(static / managed FastCGI)"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono"
              />
            </div>
          </div>

          {blueprint.envVars.length > 0 && (
            <div className="space-y-2">
              {blueprint.envVars.map((envItem, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={envItem.key}
                    onChange={(e) => updateEnvVar(idx, "key", e.target.value)}
                    placeholder="KEY_NAME"
                    className="w-2/5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono"
                  />
                  <input
                    type="text"
                    value={envItem.value}
                    onChange={(e) => updateEnvVar(idx, "value", e.target.value)}
                    placeholder="value"
                    className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvVar(idx)}
                    className="p-1.5 text-slate-400 hover:text-rose-500"
                    aria-label="Remove variable"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-800 dark:text-rose-200">
          {errorMessage}
        </div>
      )}

      {/* Provisioned Receipt */}
      {provisioned && (
        <div className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/90 dark:bg-emerald-950/30 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <h3 className="text-base font-bold text-emerald-950 dark:text-emerald-100">
                  Blueprint Persisted Visually —{" "}
                  {provisioned.readiness?.state === "LIVE_HEALTHY"
                    ? "Service Live & Healthy"
                    : "Configured (Awaiting Release Activation)"}
                </h3>
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                  Workspace <strong>{provisioned.workspace?.name ?? "Default"}</strong> • Domain{" "}
                  <strong className="font-mono">{provisioned.website.domain}</strong> • SSL{" "}
                  <strong>{provisioned.domain?.sslStatus ?? "PENDING"}</strong> • Readiness{" "}
                  <strong>{provisioned.website.healthStatus ?? "UNKNOWN"}</strong>
                </p>
                {provisioned.readiness?.note && (
                  <p className="text-[11px] text-slate-700 dark:text-slate-300 mt-0.5">
                    {provisioned.readiness.note}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/sites"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white"
              >
                Open in Sites
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/deployments"
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600/40 px-3.5 py-2 text-xs font-semibold text-emerald-900 dark:text-emerald-200 hover:bg-emerald-600/10"
              >
                Git Auto-Deploy
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 p-3 border border-emerald-200 dark:border-emerald-900">
              <div className="text-slate-500">Isolated Folder</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
                {provisioned.website.documentRoot}
              </div>
            </div>
            <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 p-3 border border-emerald-200 dark:border-emerald-900">
              <div className="text-slate-500">Runtime & Port</div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {provisioned.website.runtime}
                {provisioned.website.port ? ` (port ${provisioned.website.port})` : " (Edge/FastCGI)"}
              </div>
            </div>
            <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 p-3 border border-emerald-200 dark:border-emerald-900">
              <div className="text-slate-500">Database Config</div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {provisioned.database
                  ? `${provisioned.database.engine} (${provisioned.database.name})`
                  : "None (Stateless)"}
              </div>
            </div>
            <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 p-3 border border-emerald-200 dark:border-emerald-900">
              <div className="text-slate-500">Backups & Self-Healing</div>
              <div className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                {provisioned.backups ? `${provisioned.backups.frequency} cron` : "Manual"} •{" "}
                {provisioned.selfHealing.healthPath}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Explicit Human Confirmation Launch Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Ready to Provision: <span className="font-mono text-indigo-600 dark:text-indigo-400">{blueprint.domain}</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Workspace: <strong>{blueprint.workspaceName}</strong> • Stack: <strong>{blueprint.stackId}</strong> •{" "}
            {blueprint.database.enabled ? `DB: ${blueprint.database.engine}` : "No DB"} •{" "}
            {blueprint.autoSsl ? "Auto-SSL" : "HTTP"} •{" "}
            {blueprint.backups.enabled ? `${blueprint.backups.frequency} backups` : "No scheduled backup"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDeploy}
          disabled={deploying}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all shrink-0"
        >
          {deploying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Provisioning Project…
            </>
          ) : (
            <>
              <Rocket className="h-4 w-4" />
              Deploy Project Visually (No Terminal)
            </>
          )}
        </button>
      </div>

      {/* Existing Visually Managed Projects */}
      {!loadingInit && recentSites.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Active Visually-Managed Projects ({recentSites.length})
              </h2>
            </div>
            <Link href="/sites" className="text-xs font-medium text-indigo-600 hover:underline">
              Manage all sites →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentSites.map((site) => (
              <div
                key={site.id}
                className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {site.name || site.domain}
                  </span>
                  <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[11px] font-medium">
                    {site.status}
                  </span>
                </div>
                <div className="font-mono text-slate-600 dark:text-slate-400 truncate">
                  {site.domain}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1 text-[11px] text-slate-500">
                  {site.organization && (
                    <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5">
                      {site.organization.name}
                    </span>
                  )}
                  <span className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5">
                    {site.runtime}
                  </span>
                  {site.domains[0]?.sslEnabled && (
                    <span className="rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-2 py-0.5">
                      SSL {site.domains[0].sslStatus}
                    </span>
                  )}
                  {site.cronJobs.length > 0 && (
                    <span className="rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 px-2 py-0.5">
                      Auto-Backup
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
