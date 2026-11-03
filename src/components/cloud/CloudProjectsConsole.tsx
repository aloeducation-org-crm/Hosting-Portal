"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Code2,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  Webhook,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CLOUD_FUNCTION_RUNTIMES,
  CLOUD_PLATFORM_TYPES,
  CLOUD_PROJECT_SCOPES,
  CLOUD_REGIONS,
  CLOUD_SITE_FRAMEWORKS,
  CLOUD_STAGES,
  CLOUD_WEBHOOK_EVENTS,
  getCloudFrameworkPreset,
  slugifyCloudIdentifier,
  type AdvisorTabTarget,
  type CloudAdvisorFinding,
  type CloudPlatformType,
  type CloudStage,
} from "@/lib/cloud/catalog";

interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  organizationId: string | null;
  region: string;
  stage: CloudStage;
  frameworkPreset: string;
  renderingMode: "ssr" | "static";
  installCommand: string;
  buildCommand: string;
  outputDirectory: string;
  linkedWebsiteId: string | null;
  linkedDatabaseId: string | null;
  linkedBucketId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  counts?: {
    keys: number;
    platforms: number;
    webhooks: number;
    functions: number;
  };
}

interface LinkableResources {
  organizations: Array<{ id: string; name: string; slug: string }>;
  websites: Array<{ id: string; name: string | null; domain: string; runtime: string; status: string }>;
  databases: Array<{ id: string; name: string; engine: string; host: string; port: number }>;
  buckets: Array<{ id: string; name: string; provider: string; region: string | null; objectCount: number; sizeBytes: number; isActive: boolean }>;
}

interface ReaEvidenceEntry {
  evidenceId: string;
  kind: string;
  repository: string;
  pinnedCommit: string;
  license: string;
  sourcePath: string;
  summary: string;
  limitations: string;
}

interface ReconstructedCapabilityEntry {
  id: string;
  appwriteService: string;
  title: string;
  evidenceIds: string[];
  portalSurface: string;
  operationalState: string;
  whatWorksNow: string;
  designDifference: string;
  remainingGate: string;
}

interface ProjectWorkspaceDetail {
  canManage: boolean;
  project: ProjectSummary;
  linkedResources: {
    website: {
      id: string;
      name: string | null;
      domain: string;
      runtime: string;
      status: string;
      gitRepo: string | null;
      gitBranch: string;
      healthStatus: string | null;
      sslEnabled: boolean;
      deployments: Array<{ id: string; status: string; commitSha: string | null; branch: string; createdAt: string }>;
    } | null;
    database: { id: string; name: string; engine: string; host: string; port: number; username: string } | null;
    bucket: { id: string; name: string; provider: string; region: string | null; objectCount: number; sizeBytes: number; isActive: boolean } | null;
  };
  keys: Array<{
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    status: "ACTIVE" | "EXPIRED" | "REVOKED";
    expiresAt: string | null;
    revokedAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
  }>;
  platforms: Array<{
    id: string;
    name: string;
    type: string;
    identifier: string;
    enabled: boolean;
    createdAt: string;
  }>;
  webhooks: Array<{
    id: string;
    name: string;
    url: string;
    events: string[];
    signingKeyPrefix: string;
    enabled: boolean;
    tlsVerify: boolean;
    createdAt: string;
  }>;
  functions: Array<{
    id: string;
    slug: string;
    name: string;
    runtime: string;
    entrypoint: string;
    commands: string | null;
    events: string[];
    schedule: string | null;
    timeoutSeconds: number;
    enabled: boolean;
    executionState: string;
    createdAt: string;
  }>;
  advisor: CloudAdvisorFinding[];
  onboarding: {
    healthEndpoint: string;
    envSnippet: string;
    typescriptSnippet: string;
    curlSnippet: string;
    agentWorkspaceManifest: string;
  };
  reaReconstruction: {
    baselines: {
      appwrite: { repository: string; pinnedCommit: string; license: string; selfHostedImageReference: string };
      rea: { repository: string; pinnedCommit: string; license: string; packageBaseline: string; skillVersion: string };
    };
    evidence: ReaEvidenceEntry[];
    capabilities: ReconstructedCapabilityEntry[];
  };
}

function stageBadgeClass(stage: string): string {
  switch (stage) {
    case "production":
      return "bg-rose-500/15 text-rose-700 border-rose-500/30";
    case "staging":
      return "bg-amber-500/15 text-amber-700 border-amber-500/30";
    default:
      return "bg-sky-500/15 text-sky-700 border-sky-500/30";
  }
}

function severityBadgeClass(severity: CloudAdvisorFinding["severity"]): string {
  switch (severity) {
    case "high":
      return "bg-red-500/15 text-red-700 border-red-500/30";
    case "medium":
      return "bg-amber-500/15 text-amber-700 border-amber-500/30";
    default:
      return "bg-blue-500/15 text-blue-700 border-blue-500/30";
  }
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  } catch {
    toast.error(`Unable to copy ${label}`);
  }
}

export function CloudProjectsConsole() {
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [setupRequiredMessage, setSetupRequiredMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [linkable, setLinkable] = useState<LinkableResources>({
    organizations: [],
    websites: [],
    databases: [],
    buckets: [],
  });
  const [reaOverview, setReaOverview] = useState<ProjectWorkspaceDetail["reaReconstruction"] | null>(null);

  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<ProjectWorkspaceDetail | null>(null);
  const [activeTab, setActiveTab] = useState<AdvisorTabTarget>("overview");

  const [createOpen, setCreateOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<{ kind: string; label: string; value: string } | null>(null);

  // Create project form
  const [createForm, setCreateForm] = useState({
    name: "",
    slug: "",
    description: "",
    organizationId: "",
    region: "local-primary",
    stage: "development" as CloudStage,
    frameworkPreset: "nextjs",
    renderingMode: "ssr" as "ssr" | "static",
    linkedWebsiteId: "",
    linkedDatabaseId: "",
    linkedBucketId: "",
  });

  // Sites & resources edit draft
  const [siteDraft, setSiteDraft] = useState({
    stage: "development" as CloudStage,
    region: "local-primary",
    frameworkPreset: "nextjs",
    renderingMode: "ssr" as "ssr" | "static",
    installCommand: "npm ci",
    buildCommand: "npm run build",
    outputDirectory: "./.next",
    linkedWebsiteId: "",
    linkedDatabaseId: "",
    linkedBucketId: "",
  });

  // Key form + live tester
  const [keyForm, setKeyForm] = useState<{
    name: string;
    scopes: string[];
    expiresInDays: string;
  }>({
    name: "",
    scopes: ["project.read", "health.read", "sites.read"],
    expiresInDays: "90",
  });
  const [testApiKeyInput, setTestApiKeyInput] = useState("");
  const [healthProbeResult, setHealthProbeResult] = useState<string | null>(null);

  // Platform form
  const [platformForm, setPlatformForm] = useState<{
    name: string;
    type: CloudPlatformType;
    identifier: string;
  }>({
    name: "",
    type: "nextjs",
    identifier: "",
  });

  // Webhook form
  const [webhookForm, setWebhookForm] = useState<{
    name: string;
    url: string;
    events: string[];
    tlsVerify: boolean;
  }>({
    name: "",
    url: "",
    events: ["sites.deployments.ready", "sites.deployments.failed"],
    tlsVerify: true,
  });

  // Function form
  const [fnForm, setFnForm] = useState({
    name: "",
    runtime: "node-22",
    entrypoint: "src/main.ts",
    commands: "npm ci",
    schedule: "",
    timeoutSeconds: "15",
    events: ["sites.deployments.ready"] as string[],
  });

  const scopesByCategory = useMemo(() => {
    const grouped: Record<string, Array<(typeof CLOUD_PROJECT_SCOPES)[number]>> = {};
    for (const scope of CLOUD_PROJECT_SCOPES) {
      if (!grouped[scope.category]) grouped[scope.category] = [];
      grouped[scope.category]!.push(scope);
    }
    return grouped;
  }, []);

  const loadWorkspace = useCallback(async (preferredProjectId?: string) => {
    setError(null);
    try {
      const res = await fetch("/api/cloud/projects", { credentials: "same-origin", cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 503 && body?.error?.code === "CLOUD_SCHEMA_REQUIRES_SETUP") {
        setSetupRequiredMessage(body.message || "Cloud Projects additive migration has not been applied yet.");
        setProjects([]);
        setDetail(null);
        return;
      }
      if (!res.ok || !body.success) {
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setSetupRequiredMessage(null);
      const list: ProjectSummary[] = body.data.projects ?? [];
      setProjects(list);
      setLinkable(body.data.linkable ?? { organizations: [], websites: [], databases: [], buckets: [] });
      setReaOverview(body.data.reaReconstruction ?? null);

      const nextSelected =
        preferredProjectId ||
        (list.some((p) => p.id === selectedId) ? selectedId : list[0]?.id ?? "");
      setSelectedId(nextSelected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Cloud Projects workspace");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadProjectDetail = useCallback(async (projectId: string) => {
    if (!projectId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/cloud/projects/${encodeURIComponent(projectId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data: ProjectWorkspaceDetail = body.data;
      setDetail(data);
      setSiteDraft({
        stage: data.project.stage,
        region: data.project.region,
        frameworkPreset: data.project.frameworkPreset,
        renderingMode: data.project.renderingMode,
        installCommand: data.project.installCommand,
        buildCommand: data.project.buildCommand,
        outputDirectory: data.project.outputDirectory,
        linkedWebsiteId: data.project.linkedWebsiteId ?? "",
        linkedDatabaseId: data.project.linkedDatabaseId ?? "",
        linkedBucketId: data.project.linkedBucketId ?? "",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load project workspace");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (!cancelled) await loadWorkspace();
    });
    return () => {
      cancelled = true;
    };
  }, [loadWorkspace]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      if (selectedId) {
        await loadProjectDetail(selectedId);
      } else {
        setDetail(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, loadProjectDetail]);

  async function handleCreateProject(event: React.FormEvent) {
    event.preventDefault();
    setBusyAction("create-project");
    try {
      const payload = {
        name: createForm.name.trim(),
        ...(createForm.slug.trim() ? { slug: createForm.slug.trim() } : {}),
        ...(createForm.description.trim() ? { description: createForm.description.trim() } : {}),
        organizationId: createForm.organizationId || null,
        region: createForm.region,
        stage: createForm.stage,
        frameworkPreset: createForm.frameworkPreset,
        renderingMode: createForm.renderingMode,
        linkedWebsiteId: createForm.linkedWebsiteId || null,
        linkedDatabaseId: createForm.linkedDatabaseId || null,
        linkedBucketId: createForm.linkedBucketId || null,
      };
      const res = await fetch("/api/cloud/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || "Could not create Cloud Project");
      toast.success(`Created project ${body.data.slug}`);
      setCreateOpen(false);
      setCreateForm({
        name: "",
        slug: "",
        description: "",
        organizationId: "",
        region: "local-primary",
        stage: "development",
        frameworkPreset: "nextjs",
        renderingMode: "ssr",
        linkedWebsiteId: "",
        linkedDatabaseId: "",
        linkedBucketId: "",
      });
      await loadWorkspace(body.data.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveProjectSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusyAction("save-project");
    try {
      const res = await fetch(`/api/cloud/projects/${encodeURIComponent(detail.project.id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: siteDraft.stage,
          region: siteDraft.region,
          frameworkPreset: siteDraft.frameworkPreset,
          renderingMode: siteDraft.renderingMode,
          installCommand: siteDraft.installCommand,
          buildCommand: siteDraft.buildCommand,
          outputDirectory: siteDraft.outputDirectory,
          linkedWebsiteId: siteDraft.linkedWebsiteId || null,
          linkedDatabaseId: siteDraft.linkedDatabaseId || null,
          linkedBucketId: siteDraft.linkedBucketId || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || "Update failed");
      toast.success("Project configuration updated");
      await loadWorkspace(detail.project.id);
      await loadProjectDetail(detail.project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update project");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteProject() {
    if (!detail) return;
    setBusyAction("delete-project");
    try {
      const res = await fetch(`/api/cloud/projects/${encodeURIComponent(detail.project.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || "Delete failed");
      toast.success(`Deleted project ${detail.project.slug}`);
      setSelectedId("");
      await loadWorkspace();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleIssueKey(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusyAction("issue-key");
    try {
      const expiresInDays = keyForm.expiresInDays === "never" ? null : Number(keyForm.expiresInDays);
      const res = await fetch(`/api/cloud/projects/${encodeURIComponent(detail.project.id)}/keys`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: keyForm.name.trim(),
          scopes: keyForm.scopes,
          expiresInDays,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || "Could not issue API key");
      setRevealedSecret({
        kind: "Scoped Project API Key",
        label: body.data.key.name,
        value: body.data.secret,
      });
      setTestApiKeyInput(body.data.secret);
      setKeyForm({ name: "", scopes: ["project.read", "health.read", "sites.read"], expiresInDays: "90" });
      toast.success("API key issued — copy the secret now; only its SHA-256 digest is stored");
      await loadProjectDetail(detail.project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to issue API key");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRevokeKey(keyId: string) {
    if (!detail) return;
    setBusyAction(`revoke-key-${keyId}`);
    try {
      const res = await fetch(
        `/api/cloud/projects/${encodeURIComponent(detail.project.id)}/keys/${encodeURIComponent(keyId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || "Revoke failed");
      toast.success("API key revoked");
      await loadProjectDetail(detail.project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleProbeHealthEndpoint() {
    if (!detail || !testApiKeyInput.trim()) return;
    setBusyAction("probe-health");
    setHealthProbeResult(null);
    try {
      const res = await fetch("/api/cloud/v1/health", {
        method: "GET",
        cache: "no-store",
        headers: {
          "x-alo-project": detail.project.slug,
          "x-alo-key": testApiKeyInput.trim(),
        },
      });
      const body = await res.json().catch(() => ({}));
      setHealthProbeResult(JSON.stringify(body, null, 2));
      if (res.ok && body.success) {
        toast.success("Machine health verification passed (200 OK)");
        await loadProjectDetail(detail.project.id);
      } else {
        toast.error(body.message || `Verification rejected (${res.status})`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Health verification failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRegisterPlatform(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusyAction("add-platform");
    try {
      const res = await fetch(`/api/cloud/projects/${encodeURIComponent(detail.project.id)}/platforms`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(platformForm),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || "Could not register platform");
      toast.success(`Registered ${body.data.identifier}`);
      setPlatformForm({ name: "", type: "nextjs", identifier: "" });
      await loadProjectDetail(detail.project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to register platform");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemovePlatform(platformId: string) {
    if (!detail) return;
    setBusyAction(`del-platform-${platformId}`);
    try {
      const res = await fetch(
        `/api/cloud/projects/${encodeURIComponent(detail.project.id)}/platforms/${encodeURIComponent(platformId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || "Remove failed");
      toast.success("Platform removed");
      await loadProjectDetail(detail.project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove platform");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateWebhook(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusyAction("add-webhook");
    try {
      const res = await fetch(`/api/cloud/projects/${encodeURIComponent(detail.project.id)}/webhooks`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookForm),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || "Could not create webhook");
      setRevealedSecret({
        kind: "Webhook HMAC-SHA256 Signing Secret",
        label: body.data.webhook.name,
        value: body.data.signingSecret,
      });
      setWebhookForm({
        name: "",
        url: "",
        events: ["sites.deployments.ready", "sites.deployments.failed"],
        tlsVerify: true,
      });
      toast.success("Webhook created — copy its HMAC signing secret now");
      await loadProjectDetail(detail.project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create webhook");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemoveWebhook(webhookId: string) {
    if (!detail) return;
    setBusyAction(`del-webhook-${webhookId}`);
    try {
      const res = await fetch(
        `/api/cloud/projects/${encodeURIComponent(detail.project.id)}/webhooks/${encodeURIComponent(webhookId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || "Remove failed");
      toast.success("Webhook removed");
      await loadProjectDetail(detail.project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove webhook");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateFunction(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusyAction("add-function");
    try {
      const res = await fetch(`/api/cloud/projects/${encodeURIComponent(detail.project.id)}/functions`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fnForm.name.trim(),
          runtime: fnForm.runtime,
          entrypoint: fnForm.entrypoint.trim(),
          commands: fnForm.commands.trim() || null,
          events: fnForm.events,
          schedule: fnForm.schedule.trim() || null,
          timeoutSeconds: Number(fnForm.timeoutSeconds) || 15,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || "Could not create function");
      toast.success(`Saved function ${body.data.slug} (executionState: REQUIRES_SETUP)`);
      setFnForm({
        name: "",
        runtime: "node-22",
        entrypoint: "src/main.ts",
        commands: "npm ci",
        schedule: "",
        timeoutSeconds: "15",
        events: ["sites.deployments.ready"],
      });
      await loadProjectDetail(detail.project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create function");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemoveFunction(functionId: string) {
    if (!detail) return;
    setBusyAction(`del-fn-${functionId}`);
    try {
      const res = await fetch(
        `/api/cloud/projects/${encodeURIComponent(detail.project.id)}/functions/${encodeURIComponent(functionId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.message || "Remove failed");
      toast.success("Function removed");
      await loadProjectDetail(detail.project.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove function");
    } finally {
      setBusyAction(null);
    }
  }

  const evidenceSource = detail?.reaReconstruction ?? reaOverview;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Console Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge className="bg-[#F02E65]/15 text-[#F02E65] border-[#F02E65]/30 hover:bg-[#F02E65]/20">
              CLOUD PROJECTS • BAAS &amp; SITES
            </Badge>
            <Badge variant="outline" className="text-xs">
              REA Evidence-Bound First-Party Build
            </Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Cloud Projects Console
          </h1>
          <p className="text-sm text-slate-600 max-w-3xl">
            Appwrite-inspired developer &amp; agent workspace unifying Sites framework adapters,
            Databases, Storage buckets, scoped API keys, client platforms, SSRF-guarded webhooks,
            and deterministic posture checks per project.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadWorkspace(selectedId)}
            disabled={loading || detailLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading || detailLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="bg-[#F02E65] hover:bg-[#d82558] text-white"
            onClick={() => setCreateOpen(true)}
            disabled={Boolean(setupRequiredMessage)}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Cloud Project
          </Button>
        </div>
      </div>

      {/* Schema Setup Banner when additive migration hasn't run */}
      {setupRequiredMessage && (
        <Card className="border-amber-300 bg-amber-50/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-900">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Requires Setup — Additive Cloud Projects Schema Not Yet Applied
            </CardTitle>
            <CardDescription className="text-amber-800">
              {setupRequiredMessage}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs font-mono bg-amber-950/90 text-amber-100 rounded-md p-3 mx-6 mb-4 overflow-x-auto">
            DATABASE_URL=&quot;file:/var/lib/alo-hosting/alo.db&quot; node scripts/apply-deploy-schema.mjs
          </CardContent>
        </Card>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* One-time secret reveal alert */}
      {revealedSecret && (
        <Card className="border-emerald-400 bg-emerald-50/80">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base text-emerald-950 flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-emerald-700" />
                {revealedSecret.kind}: {revealedSecret.label}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setRevealedSecret(null)}>
                Dismiss
              </Button>
            </div>
            <CardDescription className="text-emerald-800">
              Copy this secret now. Only its SHA-256 hash is stored in SQLite — it can never be viewed again.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <code className="flex-1 rounded border bg-white px-3 py-2 text-xs font-mono break-all text-slate-900">
              {revealedSecret.value}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyText(revealedSecret.value, revealedSecret.kind)}
            >
              <Copy className="h-4 w-4 mr-1.5" />
              Copy Secret
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Project Selector Bar */}
      {projects.length > 0 && (
        <Card className="border-slate-200 bg-white">
          <CardContent className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="cloud-project-select" className="text-xs uppercase tracking-wider text-slate-500">
                Active Project
              </Label>
              <select
                id="cloud-project-select"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.slug})
                  </option>
                ))}
              </select>
              {detail && (
                <>
                  <Badge variant="outline" className={stageBadgeClass(detail.project.stage)}>
                    {detail.project.stage.toUpperCase()}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {detail.project.region}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs font-mono text-slate-600"
                    onClick={() => void copyText(detail.project.slug, "Project ID")}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    {detail.project.slug}
                  </Button>
                </>
              )}
            </div>
            {detail?.canManage && (
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700 border-red-200"
                disabled={busyAction === "delete-project"}
                onClick={() => void handleDeleteProject()}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Delete Project
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!loading && !setupRequiredMessage && projects.length === 0 && (
        <Card className="border-dashed border-2 border-slate-200 bg-white">
          <CardContent className="py-12 flex flex-col items-center text-center space-y-4">
            <div className="h-12 w-12 rounded-2xl bg-[#F02E65]/10 flex items-center justify-center">
              <Layers className="h-6 w-6 text-[#F02E65]" />
            </div>
            <div className="space-y-1 max-w-lg">
              <h2 className="text-lg font-semibold text-slate-900">
                Create your first Cloud Project
              </h2>
              <p className="text-sm text-slate-600">
                Organize your hosted Sites, Databases, Storage buckets, serverless function
                definitions, allowed client origins, webhooks, and granular API keys under one
                project boundary.
              </p>
            </div>
            <Button
              className="bg-[#F02E65] hover:bg-[#d82558] text-white"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Create Cloud Project
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Main Project Workspace Tabs */}
      {detail && (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AdvisorTabTarget)} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-slate-100 p-1">
            <TabsTrigger value="overview">Overview &amp; Advisor</TabsTrigger>
            <TabsTrigger value="sites">Sites &amp; Hosting</TabsTrigger>
            <TabsTrigger value="resources">Databases &amp; Storage</TabsTrigger>
            <TabsTrigger value="functions">Functions ({detail.functions.length})</TabsTrigger>
            <TabsTrigger value="keys">API Keys ({detail.keys.length})</TabsTrigger>
            <TabsTrigger value="platforms">Platforms ({detail.platforms.length})</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks ({detail.webhooks.length})</TabsTrigger>
            <TabsTrigger value="agents">Agents, SDK &amp; REA</TabsTrigger>
          </TabsList>

          {/* 1. OVERVIEW & ADVISOR */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <Globe className="h-4 w-4 text-[#F02E65]" /> Sites Adapter
                  </CardDescription>
                  <CardTitle className="text-lg">
                    {detail.project.frameworkPreset} ({detail.project.renderingMode.toUpperCase()})
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-600">
                  {detail.linkedResources.website
                    ? `Linked: ${detail.linkedResources.website.domain}`
                    : "No Website linked yet"}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <Database className="h-4 w-4 text-blue-600" /> Databases &amp; Storage
                  </CardDescription>
                  <CardTitle className="text-lg">
                    {(detail.linkedResources.database ? 1 : 0) + (detail.linkedResources.bucket ? 1 : 0)} Linked
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-600">
                  DB: {detail.linkedResources.database?.name ?? "unlinked"} • Bucket:{" "}
                  {detail.linkedResources.bucket?.name ?? "unlinked"}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <KeyRound className="h-4 w-4 text-emerald-600" /> Security Surface
                  </CardDescription>
                  <CardTitle className="text-lg">
                    {detail.keys.filter((k) => k.status === "ACTIVE").length} Active Keys
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-600">
                  {detail.platforms.length} platform(s) • {detail.webhooks.length} webhook(s)
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="flex items-center gap-1.5">
                    <Cpu className="h-4 w-4 text-purple-600" /> Cloud Functions
                  </CardDescription>
                  <CardTitle className="text-lg">{detail.functions.length} Defined</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-600">
                  Executor: <span className="font-medium text-amber-700">REQUIRES SETUP</span>
                </CardContent>
              </Card>
            </div>

            {/* Appwrite-style Advisor */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldCheck className="h-5 w-5 text-[#F02E65]" />
                  Project Posture Advisor
                </CardTitle>
                <CardDescription>
                  Deterministic checks computed directly from this project&apos;s stored keys,
                  platforms, webhooks, functions, and linked Hosting-Portal resources.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {detail.advisor.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    All baseline project posture checks pass for this stage.
                  </div>
                ) : (
                  detail.advisor.map((finding) => (
                    <div
                      key={finding.code}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={severityBadgeClass(finding.severity)}>
                            {finding.severity.toUpperCase()}
                          </Badge>
                          <span className="font-medium text-sm text-slate-900">{finding.title}</span>
                        </div>
                        <p className="text-xs text-slate-600">{finding.detail}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setActiveTab(finding.remediationTab)}
                      >
                        {finding.ctaLabel}
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 2. SITES & HOSTING */}
          <TabsContent value="sites" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Sites Framework Adapter &amp; Stage</CardTitle>
                <CardDescription>
                  Modeled on Appwrite Sites framework presets (`nextjs`, `tanstack-start`,
                  `sveltekit`, `astro`, `nuxt`, `vue`, `angular`, `analog`, `react`, `static`).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => void handleSaveProjectSettings(e)}>
                  <div className="space-y-1.5">
                    <Label>Environment Stage</Label>
                    <select
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                      value={siteDraft.stage}
                      onChange={(e) => setSiteDraft({ ...siteDraft, stage: e.target.value as CloudStage })}
                      disabled={!detail.canManage}
                    >
                      {CLOUD_STAGES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Region</Label>
                    <select
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                      value={siteDraft.region}
                      onChange={(e) => setSiteDraft({ ...siteDraft, region: e.target.value })}
                      disabled={!detail.canManage}
                    >
                      {CLOUD_REGIONS.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Framework Preset</Label>
                    <select
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                      value={siteDraft.frameworkPreset}
                      onChange={(e) => {
                        const key = e.target.value;
                        const preset = getCloudFrameworkPreset(key);
                        setSiteDraft({
                          ...siteDraft,
                          frameworkPreset: key,
                          renderingMode: preset?.adapter.mode ?? "ssr",
                          installCommand: preset?.adapter.installCommand ?? siteDraft.installCommand,
                          buildCommand: preset?.adapter.buildCommand ?? siteDraft.buildCommand,
                          outputDirectory: preset?.adapter.outputDirectory ?? siteDraft.outputDirectory,
                        });
                      }}
                      disabled={!detail.canManage}
                    >
                      {CLOUD_SITE_FRAMEWORKS.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.name} ({f.buildRuntime})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Rendering Adapter</Label>
                    <select
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                      value={siteDraft.renderingMode}
                      onChange={(e) => {
                        const mode = e.target.value as "ssr" | "static";
                        const preset = getCloudFrameworkPreset(siteDraft.frameworkPreset, mode);
                        setSiteDraft({
                          ...siteDraft,
                          renderingMode: mode,
                          outputDirectory: preset?.adapter.outputDirectory ?? siteDraft.outputDirectory,
                        });
                      }}
                      disabled={!detail.canManage}
                    >
                      <option value="ssr">SSR (Server-Rendered)</option>
                      <option value="static">Static / SPA Bundle</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Install Command</Label>
                    <Input
                      value={siteDraft.installCommand}
                      onChange={(e) => setSiteDraft({ ...siteDraft, installCommand: e.target.value })}
                      disabled={!detail.canManage}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Build Command</Label>
                    <Input
                      value={siteDraft.buildCommand}
                      onChange={(e) => setSiteDraft({ ...siteDraft, buildCommand: e.target.value })}
                      disabled={!detail.canManage}
                    />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Output Directory</Label>
                    <Input
                      value={siteDraft.outputDirectory}
                      onChange={(e) => setSiteDraft({ ...siteDraft, outputDirectory: e.target.value })}
                      disabled={!detail.canManage}
                    />
                  </div>

                  {detail.canManage && (
                    <div className="md:col-span-2">
                      <Button type="submit" disabled={busyAction === "save-project"}>
                        {busyAction === "save-project" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                        Save Sites Configuration
                      </Button>
                    </div>
                  )}
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Linked Hosting Site &amp; Git Deployments</CardTitle>
                    <CardDescription>
                      Connects this Cloud Project to real `/sites` and `/deployments` records.
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href="/sites">
                        Open Sites <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href="/deployments">
                        Deployments <Rocket className="h-3.5 w-3.5 ml-1.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {detail.linkedResources.website ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold">{detail.linkedResources.website.domain}</span>
                      <Badge variant="outline">{detail.linkedResources.website.runtime}</Badge>
                      <Badge variant="outline">{detail.linkedResources.website.status}</Badge>
                      <Badge
                        variant="outline"
                        className={
                          detail.linkedResources.website.sslEnabled
                            ? "border-emerald-300 text-emerald-700"
                            : "border-amber-300 text-amber-700"
                        }
                      >
                        {detail.linkedResources.website.sslEnabled ? "SSL Active" : "SSL Not Active"}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-600">
                      Health check: {detail.linkedResources.website.healthStatus ?? "not measured"} • Git:{" "}
                      {detail.linkedResources.website.gitRepo ?? "not connected"}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">
                    No Website linked yet. Bind an existing site in the Databases &amp; Storage tab or create one in{" "}
                    <Link href="/sites" className="underline font-medium">
                      /sites
                    </Link>
                    .
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 3. DATABASES & STORAGE */}
          <TabsContent value="resources" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Bind Tenant Hosting Resources</CardTitle>
                <CardDescription>
                  Cross-tenant links are blocked server-side: you can only bind Websites,
                  DatabaseInstances, and StorageBuckets owned by you or your organization.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4 md:grid-cols-3" onSubmit={(e) => void handleSaveProjectSettings(e)}>
                  <div className="space-y-1.5">
                    <Label>Linked Website</Label>
                    <select
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                      value={siteDraft.linkedWebsiteId}
                      onChange={(e) => setSiteDraft({ ...siteDraft, linkedWebsiteId: e.target.value })}
                      disabled={!detail.canManage}
                    >
                      <option value="">— None —</option>
                      {linkable.websites.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.domain} ({w.runtime})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Linked Database Instance</Label>
                    <select
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                      value={siteDraft.linkedDatabaseId}
                      onChange={(e) => setSiteDraft({ ...siteDraft, linkedDatabaseId: e.target.value })}
                      disabled={!detail.canManage}
                    >
                      <option value="">— None —</option>
                      {linkable.databases.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.engine})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Linked Storage Bucket</Label>
                    <select
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                      value={siteDraft.linkedBucketId}
                      onChange={(e) => setSiteDraft({ ...siteDraft, linkedBucketId: e.target.value })}
                      disabled={!detail.canManage}
                    >
                      <option value="">— None —</option>
                      {linkable.buckets.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.provider})
                        </option>
                      ))}
                    </select>
                  </div>

                  {detail.canManage && (
                    <div className="md:col-span-3 flex flex-wrap gap-2">
                      <Button type="submit" disabled={busyAction === "save-project"}>
                        Save Linked Resources
                      </Button>
                      <Button asChild variant="outline">
                        <Link href="/databases">
                          <Database className="h-4 w-4 mr-1.5" /> Manage Databases
                        </Link>
                      </Button>
                      <Button asChild variant="outline">
                        <Link href="/storage">
                          <HardDrive className="h-4 w-4 mr-1.5" /> Manage Storage
                        </Link>
                      </Button>
                    </div>
                  )}
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 4. FUNCTIONS */}
          <TabsContent value="functions" className="space-y-6">
            <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 text-sm text-amber-900 space-y-1">
              <p className="font-semibold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-700" />
                Execution Requires Setup — Isolated Container Runner Not Attached
              </p>
              <p className="text-xs text-amber-800">
                Function specifications, pinned runtimes, event triggers, and cron schedules are stored
                durably in SQLite. Following ALO&apos;s security policy, `/var/run/docker.sock` is never
                exposed to the web panel, so every function reports `executionState: REQUIRES_SETUP`
                until an isolated worker host is enrolled.
              </p>
            </div>

            {detail.canManage && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Register Serverless Function Spec</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="grid gap-4 md:grid-cols-3" onSubmit={(e) => void handleCreateFunction(e)}>
                    <div className="space-y-1.5">
                      <Label>Function Name</Label>
                      <Input
                        required
                        minLength={2}
                        placeholder="invoice-webhook-sync"
                        value={fnForm.name}
                        onChange={(e) => setFnForm({ ...fnForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Pinned Runtime</Label>
                      <select
                        className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                        value={fnForm.runtime}
                        onChange={(e) => {
                          const rt = CLOUD_FUNCTION_RUNTIMES.find((r) => r.id === e.target.value);
                          setFnForm({
                            ...fnForm,
                            runtime: e.target.value,
                            entrypoint: rt?.defaultEntrypoint ?? fnForm.entrypoint,
                          });
                        }}
                      >
                        {CLOUD_FUNCTION_RUNTIMES.map((rt) => (
                          <option key={rt.id} value={rt.id}>
                            {rt.label} ({rt.id})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Entrypoint</Label>
                      <Input
                        required
                        value={fnForm.entrypoint}
                        onChange={(e) => setFnForm({ ...fnForm, entrypoint: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Build Command (optional)</Label>
                      <Input
                        value={fnForm.commands}
                        onChange={(e) => setFnForm({ ...fnForm, commands: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cron Schedule (optional 5-field)</Label>
                      <Input
                        placeholder="0 * * * *"
                        value={fnForm.schedule}
                        onChange={(e) => setFnForm({ ...fnForm, schedule: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Timeout (seconds, 1–900)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={900}
                        value={fnForm.timeoutSeconds}
                        onChange={(e) => setFnForm({ ...fnForm, timeoutSeconds: e.target.value })}
                      />
                    </div>
                    <div className="md:col-span-3">
                      <Button type="submit" disabled={busyAction === "add-function"}>
                        Save Function Definition
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Project Functions ({detail.functions.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {detail.functions.length === 0 ? (
                  <p className="text-sm text-slate-500">No serverless functions defined in this project.</p>
                ) : (
                  detail.functions.map((fn) => (
                    <div
                      key={fn.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{fn.name}</span>
                          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{fn.slug}</code>
                          <Badge variant="outline">{fn.runtime}</Badge>
                          <Badge variant="outline" className="border-amber-300 text-amber-800">
                            {fn.executionState}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-600">
                          Entrypoint: <code>{fn.entrypoint}</code> • Timeout: {fn.timeoutSeconds}s
                          {fn.schedule ? ` • Cron: ${fn.schedule}` : ""}
                        </p>
                      </div>
                      {detail.canManage && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleRemoveFunction(fn.id)}
                          disabled={busyAction === `del-fn-${fn.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 5. API KEYS & SCOPES */}
          <TabsContent value="keys" className="space-y-6">
            {detail.canManage && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Issue Scoped Project API Key</CardTitle>
                  <CardDescription>
                    Modeled on Appwrite&apos;s `app/config/scopes/project.php`. Secrets use 192-bit CSPRNG
                    entropy (`alok_live_...`) and are hashed with SHA-256 before storage.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={(e) => void handleIssueKey(e)}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Key Name</Label>
                        <Input
                          required
                          minLength={2}
                          placeholder="nextjs-server-sdk"
                          value={keyForm.name}
                          onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Expiration</Label>
                        <select
                          className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                          value={keyForm.expiresInDays}
                          onChange={(e) => setKeyForm({ ...keyForm, expiresInDays: e.target.value })}
                        >
                          <option value="7">7 days</option>
                          <option value="30">30 days</option>
                          <option value="90">90 days (Recommended)</option>
                          <option value="365">365 days</option>
                          <option value="never">No expiration (Advisor warns)</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label>Granular Scopes ({keyForm.scopes.length} selected)</Label>
                      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                        {Object.entries(scopesByCategory).map(([category, items]) => (
                          <div key={category} className="rounded-lg border p-3 space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                              {category}
                            </p>
                            {items.map((sc) => {
                              const checked = keyForm.scopes.includes(sc.id);
                              return (
                                <label key={sc.id} className="flex items-start gap-2 text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5"
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? [...keyForm.scopes, sc.id]
                                        : keyForm.scopes.filter((x) => x !== sc.id);
                                      setKeyForm({ ...keyForm, scopes: next });
                                    }}
                                  />
                                  <span>
                                    <code className="font-semibold">{sc.id}</code>
                                    <span className="block text-slate-500">{sc.description}</span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>

                    <Button type="submit" disabled={busyAction === "issue-key" || keyForm.scopes.length === 0}>
                      <KeyRound className="h-4 w-4 mr-1.5" />
                      Issue Scoped API Key
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Live Machine Endpoint Tester */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Verify Scoped Key Against `/api/cloud/v1/health`</CardTitle>
                <CardDescription>
                  Sends a real machine-authenticated request (`x-alo-project: {detail.project.slug}` + `x-alo-key`)
                  requiring `health.read` or `project.read`.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="password"
                    placeholder="Paste alok_live_... secret to test"
                    value={testApiKeyInput}
                    onChange={(e) => setTestApiKeyInput(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={!testApiKeyInput.trim() || busyAction === "probe-health"}
                    onClick={() => void handleProbeHealthEndpoint()}
                  >
                    Verify Key Live
                  </Button>
                </div>
                {healthProbeResult && (
                  <pre className="rounded-lg bg-slate-950 text-slate-100 p-3 text-xs overflow-x-auto">
                    {healthProbeResult}
                  </pre>
                )}
              </CardContent>
            </Card>

            {/* Stored Keys List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Issued Keys ({detail.keys.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {detail.keys.length === 0 ? (
                  <p className="text-sm text-slate-500">No API keys issued yet.</p>
                ) : (
                  detail.keys.map((k) => (
                    <div
                      key={k.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{k.name}</span>
                          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{k.prefix}…</code>
                          <Badge
                            variant="outline"
                            className={
                              k.status === "ACTIVE"
                                ? "border-emerald-300 text-emerald-700"
                                : "border-slate-300 text-slate-600"
                            }
                          >
                            {k.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-600">
                          Scopes: {k.scopes.join(", ")} •{" "}
                          {k.expiresAt ? `Expires ${new Date(k.expiresAt).toLocaleDateString()}` : "No expiry"} •{" "}
                          {k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleString()}` : "Never used"}
                        </p>
                      </div>
                      {detail.canManage && k.status === "ACTIVE" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 border-red-200"
                          onClick={() => void handleRevokeKey(k.id)}
                          disabled={busyAction === `revoke-key-${k.id}`}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 6. PLATFORMS */}
          <TabsContent value="platforms" className="space-y-6">
            {detail.canManage && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Register Client Platform (Web / Mobile / Native)</CardTitle>
                  <CardDescription>
                    Web platforms validate domain hostnames (`localhost` is blocked on `production` stage);
                    mobile/native platforms validate reverse-DNS bundle or package IDs.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="grid gap-4 md:grid-cols-3" onSubmit={(e) => void handleRegisterPlatform(e)}>
                    <div className="space-y-1.5">
                      <Label>App Label</Label>
                      <Input
                        required
                        minLength={2}
                        placeholder="Student Web Portal"
                        value={platformForm.name}
                        onChange={(e) => setPlatformForm({ ...platformForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Platform Type</Label>
                      <select
                        className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                        value={platformForm.type}
                        onChange={(e) =>
                          setPlatformForm({ ...platformForm, type: e.target.value as CloudPlatformType })
                        }
                      >
                        {CLOUD_PLATFORM_TYPES.map((pt) => (
                          <option key={pt.id} value={pt.id}>
                            {pt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Hostname or Bundle ID</Label>
                      <Input
                        required
                        placeholder={
                          CLOUD_PLATFORM_TYPES.find((p) => p.id === platformForm.type)?.kind === "hostname"
                            ? "portal.alolabs.net"
                            : "net.alolabs.student"
                        }
                        value={platformForm.identifier}
                        onChange={(e) => setPlatformForm({ ...platformForm, identifier: e.target.value })}
                      />
                    </div>
                    <div className="md:col-span-3">
                      <Button type="submit" disabled={busyAction === "add-platform"}>
                        <Smartphone className="h-4 w-4 mr-1.5" /> Register Platform
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Registered Platforms ({detail.platforms.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {detail.platforms.length === 0 ? (
                  <p className="text-sm text-slate-500">No client platforms registered.</p>
                ) : (
                  detail.platforms.map((pl) => (
                    <div
                      key={pl.id}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                    >
                      <div>
                        <span className="font-semibold">{pl.name}</span>{" "}
                        <Badge variant="outline" className="ml-1">
                          {pl.type}
                        </Badge>
                        <p className="text-xs font-mono text-slate-600 mt-0.5">{pl.identifier}</p>
                      </div>
                      {detail.canManage && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleRemovePlatform(pl.id)}
                          disabled={busyAction === `del-platform-${pl.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 7. WEBHOOKS */}
          <TabsContent value="webhooks" className="space-y-6">
            {detail.canManage && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Create Event Webhook (HTTPS + SSRF Guard)</CardTitle>
                  <CardDescription>
                    Rejects plain HTTP, embedded credentials, localhost, RFC1918 private IPs, and cloud
                    metadata endpoints. Issues a one-time HMAC-SHA256 signing secret.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={(e) => void handleCreateWebhook(e)}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Webhook Name</Label>
                        <Input
                          required
                          minLength={2}
                          placeholder="Lark Deploy Alert"
                          value={webhookForm.name}
                          onChange={(e) => setWebhookForm({ ...webhookForm, name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>HTTPS Target URL</Label>
                        <Input
                          required
                          placeholder="https://hooks.example.org/alo-events"
                          value={webhookForm.url}
                          onChange={(e) => setWebhookForm({ ...webhookForm, url: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Subscribed Events ({webhookForm.events.length})</Label>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {CLOUD_WEBHOOK_EVENTS.map((ev) => {
                          const checked = webhookForm.events.includes(ev);
                          return (
                            <label key={ev} className="flex items-center gap-2 text-xs rounded border p-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...webhookForm.events, ev]
                                    : webhookForm.events.filter((x) => x !== ev);
                                  setWebhookForm({ ...webhookForm, events: next });
                                }}
                              />
                              <code>{ev}</code>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={webhookForm.tlsVerify}
                        onChange={(e) => setWebhookForm({ ...webhookForm, tlsVerify: e.target.checked })}
                      />
                      Enforce strict TLS certificate verification (Recommended)
                    </label>

                    <Button type="submit" disabled={busyAction === "add-webhook" || webhookForm.events.length === 0}>
                      <Webhook className="h-4 w-4 mr-1.5" /> Create Webhook
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Project Webhooks ({detail.webhooks.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {detail.webhooks.length === 0 ? (
                  <p className="text-sm text-slate-500">No webhooks configured.</p>
                ) : (
                  detail.webhooks.map((wh) => (
                    <div
                      key={wh.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{wh.name}</span>
                          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                            {wh.signingKeyPrefix}…
                          </code>
                          <Badge variant="outline">
                            {wh.tlsVerify ? "TLS Verified" : "TLS Disabled"}
                          </Badge>
                        </div>
                        <p className="text-xs font-mono break-all text-slate-700">{wh.url}</p>
                        <p className="text-xs text-slate-500">Events: {wh.events.join(", ")}</p>
                      </div>
                      {detail.canManage && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleRemoveWebhook(wh.id)}
                          disabled={busyAction === `del-webhook-${wh.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 8. AGENTS, SDK & REA EVIDENCE */}
          <TabsContent value="agents" className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Code2 className="h-4 w-4 text-[#F02E65]" /> Environment &amp; TypeScript Quickstart
                    </CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void copyText(
                          `${detail.onboarding.envSnippet}\n\n${detail.onboarding.typescriptSnippet}`,
                          "Quickstart snippet",
                        )
                      }
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                    </Button>
                  </div>
                  <CardDescription>
                    Zero plaintext secrets are embedded; supply `ALO_CLOUD_API_KEY` from local `.env.local`.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <pre className="rounded-lg bg-slate-950 text-slate-100 p-3 text-xs overflow-x-auto">
                    {detail.onboarding.envSnippet}
                  </pre>
                  <pre className="rounded-lg bg-slate-950 text-slate-100 p-3 text-xs overflow-x-auto">
                    {detail.onboarding.typescriptSnippet}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Bot className="h-4 w-4 text-purple-600" /> Coding Agent &amp; cURL Verification
                    </CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(detail.onboarding.agentWorkspaceManifest, "Agent manifest")}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy JSON
                    </Button>
                  </div>
                  <CardDescription>
                    Also available inside `/ai/automations` via the read-only `hosting.cloudProjects` node.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <pre className="rounded-lg bg-slate-950 text-slate-100 p-3 text-xs overflow-x-auto">
                    {detail.onboarding.curlSnippet}
                  </pre>
                  <pre className="rounded-lg bg-slate-950 text-slate-100 p-3 text-xs overflow-x-auto">
                    {detail.onboarding.agentWorkspaceManifest}
                  </pre>
                </CardContent>
              </Card>
            </div>

            {evidenceSource && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    REA Source Evidence &amp; Appwrite Reconstruction Matrix
                  </CardTitle>
                  <CardDescription>
                    Pinned baselines: <code>{evidenceSource.baselines.appwrite.repository}</code> @{" "}
                    <code>{evidenceSource.baselines.appwrite.pinnedCommit.slice(0, 12)}</code> (
                    {evidenceSource.baselines.appwrite.license}) •{" "}
                    <code>{evidenceSource.baselines.rea.repository}</code> @{" "}
                    <code>{evidenceSource.baselines.rea.pinnedCommit.slice(0, 12)}</code> (
                    {evidenceSource.baselines.rea.license}, SKILL v{evidenceSource.baselines.rea.skillVersion}).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    {evidenceSource.capabilities.map((cap) => (
                      <div key={cap.id} className="rounded-lg border p-3 text-xs space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">{cap.title}</span>
                          <Badge variant="outline">{cap.operationalState}</Badge>
                        </div>
                        <p className="text-slate-500">Upstream: {cap.appwriteService}</p>
                        <p className="text-slate-700">{cap.whatWorksNow}</p>
                        <p className="text-slate-500">
                          <strong>Boundary:</strong> {cap.remainingGate}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Create Cloud Project Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Cloud Project</DialogTitle>
            <DialogDescription>
              Initialize a project-scoped BaaS &amp; Sites workspace with Appwrite-style framework
              presets and tenant isolation.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => void handleCreateProject(e)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Project Name</Label>
                <Input
                  required
                  minLength={2}
                  placeholder="ALO Student Portal"
                  value={createForm.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setCreateForm((prev) => ({
                      ...prev,
                      name,
                      slug: prev.slug || slugifyCloudIdentifier(name),
                    }));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Project ID / Slug</Label>
                <Input
                  required
                  minLength={2}
                  placeholder="alo-student-portal"
                  value={createForm.slug}
                  onChange={(e) => setCreateForm({ ...createForm, slug: slugifyCloudIdentifier(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Organization (optional)</Label>
                <select
                  className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                  value={createForm.organizationId}
                  onChange={(e) => setCreateForm({ ...createForm, organizationId: e.target.value })}
                >
                  <option value="">Personal / Owner-Scoped</option>
                  {linkable.organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Environment Stage</Label>
                <select
                  className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                  value={createForm.stage}
                  onChange={(e) => setCreateForm({ ...createForm, stage: e.target.value as CloudStage })}
                >
                  {CLOUD_STAGES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Sites Framework Preset</Label>
                <select
                  className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                  value={createForm.frameworkPreset}
                  onChange={(e) => {
                    const preset = getCloudFrameworkPreset(e.target.value);
                    setCreateForm({
                      ...createForm,
                      frameworkPreset: e.target.value,
                      renderingMode: preset?.adapter.mode ?? "ssr",
                    });
                  }}
                >
                  {CLOUD_SITE_FRAMEWORKS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Region</Label>
                <select
                  className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                  value={createForm.region}
                  onChange={(e) => setCreateForm({ ...createForm, region: e.target.value })}
                >
                  {CLOUD_REGIONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Input
                placeholder="Frontend, student database, and document bucket workspace"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-[#F02E65] hover:bg-[#d82558] text-white"
                disabled={busyAction === "create-project"}
              >
                {busyAction === "create-project" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Create Project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
