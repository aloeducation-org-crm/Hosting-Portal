"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Scale,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type EnvVarSpec = {
  key: string;
  label: string;
  description: string;
  required: boolean;
  secret: boolean;
  autoGenerateSecret: boolean;
  defaultValue?: string;
};

type AgentPreset = {
  id: string;
  name: string;
  category: string;
  architectureKind: string;
  deploymentMode:
    | "single-container-verified"
    | "multi-service-compose"
    | "sdk-runtime"
    | "restricted-commercial-review";
  auditDecision: string;
  upstreamRepo: string;
  docsUrl: string;
  verifiedReleaseVersion: string;
  licenseIdentifier: string;
  enterpriseDirectoryPresent: boolean;
  licenseTriage: string;
  commercialMultiTenantAllowed: "yes" | "conditional" | "no";
  licenseNotes: string;
  summary: string;
  dockerImage: string | null;
  defaultHostPort: number | null;
  containerPort: number | null;
  healthcheckPath: string | null;
  namedVolumeTarget: string | null;
  backupGuidance: string;
  hardwareMinimum: {
    cpuCores: number;
    ramGb: number;
    diskGb: number;
    gpuRequired: boolean;
    recommendedVramGb: number;
  };
  containerLimits: { cpus: string; memory: string };
  supportedInferenceBackends: string[];
  securityNotes: string[];
  envVars: EnvVarSpec[];
};

type DecisionMatrixRow = {
  useCaseId: string;
  useCase: string;
  primaryRecommendation: string;
  primaryArchitectureKind: string;
  secondaryAlternative: string;
  avoidOrCaution: string;
  rationale: string;
  licenseStatus: string;
};

type SizingMatrixRow = {
  profile: string;
  paramsBillions: number;
  quantization: string;
  contextLengthTokens: number;
  concurrency: number;
  totalVramGb: number;
  recommendedGpu: string;
  recommendedSystemRamGb: number;
  recommendedDiskGb: number;
};

type DeployedContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  portMapping: string | null;
  envVarKeys: string[];
  website?: { id: string; name: string; domain: string } | null;
};

type DeploymentPlan = {
  valid: boolean;
  canDirectDeploy: boolean;
  errors: string[];
  warnings: string[];
  instanceName: string;
  loopbackPortMapping: string | null;
  namedVolumeSpec: string | null;
  healthcheckUrl: string | null;
  hostFit: {
    verdict: "FIT" | "TIGHT" | "INSUFFICIENT";
    host: { cpuCores: number; totalRamGb: number; freeRamGb: number };
    notes: string[];
  };
  redactedEnvPreview: Record<string, string>;
  securityPosture: string[];
  backupGuidance: string;
  rollbackSteps: string[];
};

type CustomSizingResult = {
  verdict: "FIT" | "TIGHT" | "INSUFFICIENT";
  executionMode: string;
  totalAvailableVramGb: number;
  vramHeadroomGb: number;
  ramHeadroomGb: number;
  diskHeadroomGb: number;
  breakdown: {
    weightsMemoryGb: number;
    kvCacheMemoryGb: number;
    runtimeOverheadGb: number;
    fragmentationReserveGb: number;
    totalInferenceVramGb: number;
    recommendedSystemRamGb: number;
    recommendedDiskGb: number;
  };
  reasons: string[];
};

function licenseBadgeVariant(triage: string): "default" | "secondary" | "destructive" | "outline" {
  if (triage === "License verified for intended use") return "default";
  if (triage === "Commercial permission required or potentially required" || triage === "Not approved pending legal review") {
    return "destructive";
  }
  return "secondary";
}

export function ZeroTerminalDeployAssistant() {
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<AgentPreset[]>([]);
  const [decisionMatrix, setDecisionMatrix] = useState<DecisionMatrixRow[]>([]);
  const [sizingMatrix, setSizingMatrix] = useState<SizingMatrixRow[]>([]);
  const [hostCapacity, setHostCapacity] = useState<{ cpuCores: number; totalRamGb: number; freeRamGb: number } | null>(null);
  const [deployments, setDeployments] = useState<DeployedContainer[]>([]);
  const [websites, setWebsites] = useState<Array<{ id: string; name: string; domain: string }>>([]);

  const [selectedPresetId, setSelectedPresetId] = useState<string>("langflow");
  const [instanceName, setInstanceName] = useState<string>("alo-langflow");
  const [hostPort, setHostPort] = useState<string>("7860");
  const [websiteId, setWebsiteId] = useState<string>("");
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [acknowledgeLicense, setAcknowledgeLicense] = useState<boolean>(false);

  const [planning, setPlanning] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [plan, setPlan] = useState<DeploymentPlan | null>(null);
  const [readinessByContainer, setReadinessByContainer] = useState<
    Record<string, { state: string; detail: string; latencyMs: number }>
  >({});

  // Custom hardware sizing form
  const [paramsB, setParamsB] = useState("8");
  const [quant, setQuant] = useState("q4_k_m");
  const [ctxLen, setCtxLen] = useState("16384");
  const [concurrency, setConcurrency] = useState("4");
  const [gpuCount, setGpuCount] = useState("1");
  const [vramGb, setVramGb] = useState("24");
  const [sysRamGb, setSysRamGb] = useState("32");
  const [diskGb, setDiskGb] = useState("100");
  const [sizingResult, setSizingResult] = useState<CustomSizingResult | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/deploy-assistant", { credentials: "include" });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error?.message ?? "Failed to load self-hosted AI catalog");
      }
      const data = body.data;
      setCatalog(data.catalog ?? []);
      setDecisionMatrix(data.decisionMatrix ?? []);
      setSizingMatrix(data.sizingMatrix ?? []);
      setHostCapacity(data.hostCapacity ?? null);
      setDeployments(data.deployments ?? []);
      setWebsites(data.websites ?? []);
      if (data.websites?.[0]?.id) {
        setWebsiteId((prev) => prev || data.websites[0].id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load deployment assistant");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await loadAll();
    })();
    return () => {
      active = false;
    };
  }, [loadAll]);

  const selectedPreset = useMemo(
    () => catalog.find((item) => item.id === selectedPresetId) ?? catalog[0] ?? null,
    [catalog, selectedPresetId],
  );

  const selectPreset = (preset: AgentPreset) => {
    setSelectedPresetId(preset.id);
    setInstanceName(`alo-${preset.id}`);
    setHostPort(preset.defaultHostPort ? String(preset.defaultHostPort) : "");
    const defaults: Record<string, string> = {};
    for (const ev of preset.envVars) {
      if (ev.defaultValue !== undefined && !ev.secret) {
        defaults[ev.key] = ev.defaultValue;
      }
    }
    setEnvValues(defaults);
    setAcknowledgeLicense(false);
    setPlan(null);
  };

  const runPlan = async () => {
    if (!selectedPreset) return;
    setPlanning(true);
    try {
      const res = await fetch("/api/ai/deploy-assistant", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "plan",
          presetId: selectedPreset.id,
          instanceName,
          websiteId: websiteId || null,
          hostPort: hostPort ? Number.parseInt(hostPort, 10) : undefined,
          envOverrides: envValues,
          acknowledgeLicenseTerms: acknowledgeLicense,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error?.details ?? body?.error?.message ?? "Plan validation failed");
      }
      setPlan(body.data.plan);
      if (body.data.plan.valid) {
        toast.success("Pre-flight validation passed");
      } else {
        toast.warning("Plan has blocking compliance or capacity checks");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setPlanning(false);
    }
  };

  const runDeploy = async () => {
    if (!selectedPreset) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/ai/deploy-assistant", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "deploy",
          presetId: selectedPreset.id,
          instanceName,
          websiteId: websiteId || null,
          hostPort: hostPort ? Number.parseInt(hostPort, 10) : undefined,
          envOverrides: envValues,
          acknowledgeLicenseTerms: acknowledgeLicense,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.error?.details ?? body?.error?.message ?? "Deployment failed");
      }
      toast.success(
        body.data.idempotent
          ? body.data.message
          : `Deployed ${selectedPreset.name} on loopback ${body.data.container?.portMapping ?? ""}`,
      );
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setDeploying(false);
    }
  };

  const checkReadiness = async (containerId: string) => {
    try {
      const res = await fetch(`/api/ai/deploy-assistant?readiness=${encodeURIComponent(containerId)}`, {
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error?.message ?? "Probe failed");
      const r = body.data.readiness;
      setReadinessByContainer((prev) => ({ ...prev, [containerId]: r }));
      if (r.state === "READY") toast.success(r.detail);
      else toast.info(r.detail);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Readiness check failed");
    }
  };

  const uninstallContainer = async (containerId: string, name: string) => {
    try {
      const res = await fetch("/api/ai/deploy-assistant", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "uninstall", containerId }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error?.message ?? "Uninstall failed");
      toast.success(
        body.data?.verificationNote ??
          `Stopped and removed container ${name}; verify and back up named volume before cleanup or redeployment.`,
      );
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Uninstall failed");
    }
  };

  const evaluateCustomSizing = async () => {
    try {
      const res = await fetch("/api/ai/deploy-assistant", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "sizing",
          paramsBillions: Number(paramsB),
          quantization: quant,
          contextLengthTokens: Number.parseInt(ctxLen, 10),
          concurrency: Number.parseInt(concurrency, 10),
          orchestrationRamGb: 2,
          host: {
            cpuCores: hostCapacity?.cpuCores ?? 8,
            systemRamGb: Number(sysRamGb),
            gpuCount: Number.parseInt(gpuCount, 10),
            vramPerGpuGb: Number(vramGb),
            availableDiskGb: Number(diskGb),
          },
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error?.details ?? "Sizing evaluation failed");
      setSizingResult(body.data.evaluation);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sizing check failed");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading self-hosted AI catalog & host capacity...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold">
            <Server className="h-6 w-6 text-indigo-600" />
            Self-Hosted AI Agents & Zero-Terminal Deployment
          </h2>
          <p className="text-sm text-muted-foreground">
            Pinned-version container presets bound strictly to <code>127.0.0.1</code> with dropped capabilities, named
            volume persistence, verified license gates, and honest hardware sizing.
          </p>
        </div>
        {hostCapacity && (
          <Badge variant="outline" className="px-3 py-1.5 text-xs">
            <Cpu className="mr-1.5 h-3.5 w-3.5" />
            Host: {hostCapacity.cpuCores} vCPU · {hostCapacity.freeRamGb} GB free / {hostCapacity.totalRamGb} GB RAM
          </Badge>
        )}
      </div>

      <Tabs defaultValue="deploy" className="space-y-4">
        <TabsList>
          <TabsTrigger value="deploy">Zero-Terminal Deploy ({catalog.length})</TabsTrigger>
          <TabsTrigger value="sizing">Hardware & VRAM Calculator</TabsTrigger>
          <TabsTrigger value="matrix">13-Use-Case Decision Matrix</TabsTrigger>
        </TabsList>

        <TabsContent value="deploy" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left column: Catalog list */}
            <div className="space-y-3 lg:col-span-5">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Audited Agent & Inference Catalog
              </div>
              <div className="max-h-[680px] space-y-2.5 overflow-y-auto pr-1">
                {catalog.map((preset) => {
                  const active = selectedPreset?.id === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => selectPreset(preset)}
                      className={`w-full rounded-lg border p-3.5 text-left transition ${
                        active
                          ? "border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-sm">{preset.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {preset.verifiedReleaseVersion} · {preset.architectureKind}
                          </div>
                        </div>
                        <Badge variant={preset.deploymentMode === "single-container-verified" ? "default" : "outline"}>
                          {preset.deploymentMode === "single-container-verified"
                            ? "Click Deploy"
                            : preset.deploymentMode === "multi-service-compose"
                              ? "Compose Stack"
                              : preset.deploymentMode === "sdk-runtime"
                                ? "SDK / Code"
                                : "Restricted"}
                        </Badge>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{preset.summary}</p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant={licenseBadgeVariant(preset.licenseTriage)} className="text-[10px]">
                          {preset.licenseTriage}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          Min: {preset.hardwareMinimum.cpuCores} vCPU / {preset.hardwareMinimum.ramGb} GB RAM
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right column: Selected Preset Wizard */}
            <div className="space-y-4 lg:col-span-7">
              {selectedPreset && (
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <CardTitle>{selectedPreset.name}</CardTitle>
                        <CardDescription className="mt-1">
                          License: <strong>{selectedPreset.licenseIdentifier}</strong> · Audit Decision:{" "}
                          <strong>{selectedPreset.auditDecision}</strong>
                        </CardDescription>
                      </div>
                      {selectedPreset.dockerImage && (
                        <code className="rounded bg-muted px-2 py-1 text-xs">{selectedPreset.dockerImage}</code>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1.5">
                      <div className="flex items-center gap-1.5 font-medium">
                        <Scale className="h-4 w-4 text-amber-600" />
                        Licensing & Commercial Suitability ({selectedPreset.licenseTriage})
                      </div>
                      <p className="text-muted-foreground">{selectedPreset.licenseNotes}</p>
                    </div>

                    {selectedPreset.deploymentMode === "single-container-verified" ? (
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="agent-instance-name">Container Name</Label>
                            <Input
                              id="agent-instance-name"
                              value={instanceName}
                              onChange={(e) => setInstanceName(e.target.value)}
                              placeholder="alo-langflow"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="agent-host-port">Loopback Host Port (127.0.0.1)</Label>
                            <Input
                              id="agent-host-port"
                              type="number"
                              min={1024}
                              max={65535}
                              value={hostPort}
                              onChange={(e) => setHostPort(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="agent-website">Tenant Workspace</Label>
                            <select
                              id="agent-website"
                              value={websiteId}
                              onChange={(e) => setWebsiteId(e.target.value)}
                              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                            >
                              <option value="">Platform / Default Owned Site</option>
                              {websites.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name} ({w.domain})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {selectedPreset.envVars.length > 0 && (
                          <div className="space-y-2.5">
                            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                              Environment & Secret Configuration
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {selectedPreset.envVars.map((ev) => (
                                <div key={ev.key} className="space-y-1">
                                  <Label htmlFor={`env-${ev.key}`} className="text-xs">
                                    {ev.label} (<code>{ev.key}</code>)
                                    {ev.autoGenerateSecret && (
                                      <span className="ml-1 text-[10px] text-emerald-600">
                                        [auto-generated if blank]
                                      </span>
                                    )}
                                  </Label>
                                  <Input
                                    id={`env-${ev.key}`}
                                    type={ev.secret ? "password" : "text"}
                                    placeholder={
                                      ev.autoGenerateSecret
                                        ? "Leave blank to auto-generate strong 24-byte secret"
                                        : ev.defaultValue ?? ""
                                    }
                                    value={envValues[ev.key] ?? ""}
                                    onChange={(e) =>
                                      setEnvValues((prev) => ({ ...prev, [ev.key]: e.target.value }))
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {(selectedPreset.licenseTriage === "Conditional, requires additional review" ||
                          selectedPreset.licenseTriage === "Internal use recommended") && (
                          <div className="flex items-start space-x-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                            <Checkbox
                              id="ack-license"
                              checked={acknowledgeLicense}
                              onCheckedChange={(checked) => setAcknowledgeLicense(Boolean(checked))}
                            />
                            <Label htmlFor="ack-license" className="text-xs leading-relaxed">
                              I acknowledge the upstream license terms ({selectedPreset.licenseIdentifier}) and confirm
                              this deployment complies with single-tenant/internal or branding limits.
                            </Label>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={runPlan} disabled={planning || deploying}>
                            {planning ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <ShieldCheck className="mr-2 h-4 w-4" />
                            )}
                            Validate Pre-Flight Plan
                          </Button>
                          <Button onClick={runDeploy} disabled={deploying || planning}>
                            {deploying ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="mr-2 h-4 w-4" />
                            )}
                            Provision Hardened Container
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs space-y-2">
                        <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                          <ShieldAlert className="h-4 w-4" />
                          Direct Single-Container Provisioning Disabled ({selectedPreset.deploymentMode})
                        </div>
                        <p className="text-muted-foreground">
                          {selectedPreset.deploymentMode === "multi-service-compose" &&
                            "This platform requires multiple backing databases/workers (PostgreSQL/MongoDB/Redis/ClickHouse). Provision via Docker Compose on an appropriately sized VM rather than a single container."}
                          {selectedPreset.deploymentMode === "sdk-runtime" &&
                            "This entry is a code-first Python/TypeScript SDK (not a ready-made web server). Embed it in an application container and point its OpenAI client at the ALO Gateway."}
                          {selectedPreset.deploymentMode === "restricted-commercial-review" &&
                            "Blocked from self-service portal deployment due to multi-tenant commercial licensing restrictions or Docker-socket container escape risks."}
                        </p>
                      </div>
                    )}

                    {/* Security & Backup Notes */}
                    <div className="rounded-md border p-3 text-xs space-y-1.5">
                      <div className="font-medium">Security & Backup Guidance</div>
                      <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                        {selectedPreset.securityNotes.map((note, idx) => (
                          <li key={idx}>{note}</li>
                        ))}
                        <li>Backup: {selectedPreset.backupGuidance}</li>
                      </ul>
                    </div>

                    {/* Pre-flight plan output */}
                    {plan && (
                      <div className="rounded-md border p-3.5 text-xs space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold flex items-center gap-1.5">
                            {plan.valid ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-destructive" />
                            )}
                            Pre-Flight Plan ({plan.valid ? "READY TO DEPLOY" : "BLOCKED"})
                          </span>
                          <Badge variant={plan.hostFit.verdict === "FIT" ? "default" : "secondary"}>
                            Host Capacity: {plan.hostFit.verdict}
                          </Badge>
                        </div>
                        {plan.errors.length > 0 && (
                          <ul className="list-disc pl-4 text-destructive space-y-0.5">
                            {plan.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        )}
                        {plan.warnings.length > 0 && (
                          <ul className="list-disc pl-4 text-amber-600 space-y-0.5">
                            {plan.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        )}
                        <div className="grid gap-2 sm:grid-cols-2 text-muted-foreground">
                          <div>
                            <strong>Bind:</strong> <code>{plan.loopbackPortMapping ?? "N/A"}</code>
                          </div>
                          <div>
                            <strong>Named Volume:</strong> <code>{plan.namedVolumeSpec ?? "N/A"}</code>
                          </div>
                          <div className="sm:col-span-2">
                            <strong>Readiness Probe:</strong> <code>{plan.healthcheckUrl ?? "N/A"}</code>
                          </div>
                        </div>
                        {plan.rollbackSteps.length > 0 && (
                          <div className="border-t pt-2 space-y-1">
                            <div className="font-medium">Rollback &amp; Volume Verification Procedure</div>
                            <ol className="list-decimal pl-4 text-muted-foreground space-y-0.5">
                              {plan.rollbackSteps.map((step, idx) => (
                                <li key={idx}>{step}</li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Active Deployments */}
              <Card>
                <CardHeader className="py-4">
                  <CardTitle className="text-base">Provisioned Self-Hosted AI Containers</CardTitle>
                  <CardDescription className="text-xs">
                    Secrets are masked server-side. Uninstalling stops and removes the container without passing{" "}
                    <code>-v</code>; always confirm container removal and verify/back up{" "}
                    <code>alo-agent-&lt;name&gt;</code> before cleanup or redeployment.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {deployments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No self-hosted AI containers provisioned yet.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {deployments.map((dep) => {
                        const probe = readinessByContainer[dep.id];
                        return (
                          <div
                            key={dep.id}
                            className="flex flex-col gap-2 rounded-md border p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <div className="font-medium flex items-center gap-2">
                                {dep.name}
                                <Badge variant="outline">{dep.status}</Badge>
                                {probe && (
                                  <Badge variant={probe.state === "READY" ? "default" : "secondary"}>
                                    {probe.state} ({probe.latencyMs}ms)
                                  </Badge>
                                )}
                              </div>
                              <div className="text-muted-foreground mt-0.5">
                                <code>{dep.image}</code> · Bind: <code>{dep.portMapping ?? "none"}</code> · Redacted
                                keys: {dep.envVarKeys.length}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button size="sm" variant="outline" onClick={() => checkReadiness(dep.id)}>
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                Verify Readiness
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => uninstallContainer(dep.id, dep.name)}
                              >
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                Uninstall
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Hardware & VRAM Calculator Tab */}
        <TabsContent value="sizing" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <HardDrive className="h-5 w-5" /> Interactive Inference VRAM, KV-Cache & Host RAM Estimator
              </CardTitle>
              <CardDescription>
                Accounts for quantized weights, GQA KV-cache across context window × concurrent users, CUDA/runtime
                buffers, and 12% VRAM allocator headroom.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Model Parameters (Billions)</Label>
                  <Input type="number" value={paramsB} onChange={(e) => setParamsB(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Quantization</Label>
                  <select
                    value={quant}
                    onChange={(e) => setQuant(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  >
                    <option value="q4_k_m">Q4_K_M (~4-bit GGUF)</option>
                    <option value="awq_4bit">AWQ 4-bit (GPU)</option>
                    <option value="q5_k_m">Q5_K_M (~5-bit GGUF)</option>
                    <option value="q6_k">Q6_K (~6-bit GGUF)</option>
                    <option value="fp8">FP8 (Ada/Hopper GPU)</option>
                    <option value="int8">INT8</option>
                    <option value="fp16">FP16 / BF16 (16-bit)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Context Window (Tokens)</Label>
                  <Input type="number" value={ctxLen} onChange={(e) => setCtxLen(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Concurrent Active Sequences</Label>
                  <Input type="number" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">GPU Count</Label>
                  <Input type="number" value={gpuCount} onChange={(e) => setGpuCount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">VRAM per GPU (GB)</Label>
                  <Input type="number" value={vramGb} onChange={(e) => setVramGb(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">System RAM (GB)</Label>
                  <Input type="number" value={sysRamGb} onChange={(e) => setSysRamGb(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Free Disk (GB)</Label>
                  <Input type="number" value={diskGb} onChange={(e) => setDiskGb(e.target.value)} />
                </div>
              </div>
              <Button onClick={evaluateCustomSizing}>Calculate Hardware Fit</Button>

              {sizingResult && (
                <div className="rounded-md border p-4 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    Verdict:
                    <Badge
                      variant={
                        sizingResult.verdict === "FIT"
                          ? "default"
                          : sizingResult.verdict === "TIGHT"
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {sizingResult.verdict} ({sizingResult.executionMode})
                    </Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4 text-muted-foreground">
                    <div>Weights: {sizingResult.breakdown.weightsMemoryGb} GB</div>
                    <div>KV Cache: {sizingResult.breakdown.kvCacheMemoryGb} GB</div>
                    <div>Total VRAM Needed: {sizingResult.breakdown.totalInferenceVramGb} GB</div>
                    <div>Min Disk: {sizingResult.breakdown.recommendedDiskGb} GB</div>
                  </div>
                  <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                    {sizingResult.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reference Production Sizing Profiles</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-3">Workload Profile</th>
                    <th className="py-2 pr-3">Context × Users</th>
                    <th className="py-2 pr-3">Est. VRAM</th>
                    <th className="py-2 pr-3">Sys RAM / Disk</th>
                    <th className="py-2">Recommended Hardware</th>
                  </tr>
                </thead>
                <tbody>
                  {sizingMatrix.map((row) => (
                    <tr key={row.profile} className="border-b last:border-0">
                      <td className="py-2.5 pr-3 font-medium">{row.profile}</td>
                      <td className="py-2.5 pr-3">
                        {row.contextLengthTokens.toLocaleString()} × {row.concurrency}
                      </td>
                      <td className="py-2.5 pr-3 font-mono">{row.totalVramGb} GB</td>
                      <td className="py-2.5 pr-3">
                        {row.recommendedSystemRamGb} GB / {row.recommendedDiskGb} GB
                      </td>
                      <td className="py-2.5 text-muted-foreground">{row.recommendedGpu}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 13-Use-Case Decision Matrix Tab */}
        <TabsContent value="matrix">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">13-Use-Case Self-Hosted AI Platform Decision Matrix</CardTitle>
              <CardDescription className="text-xs">
                Separates Python/TS SDKs, single-container visual servers, multi-container Compose stacks, and
                license-restricted commercial platforms.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-3">Use Case</th>
                    <th className="py-2 pr-3">Primary Recommendation</th>
                    <th className="py-2 pr-3">Secondary Alternative</th>
                    <th className="py-2 pr-3">Avoid / Caution</th>
                    <th className="py-2">License Triage</th>
                  </tr>
                </thead>
                <tbody>
                  {decisionMatrix.map((entry) => (
                    <tr key={entry.useCaseId} className="border-b align-top last:border-0">
                      <td className="py-2.5 pr-3 font-medium">{entry.useCase}</td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">{entry.primaryRecommendation}</div>
                        <div className="text-[11px] text-muted-foreground">{entry.primaryArchitectureKind}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{entry.secondaryAlternative}</td>
                      <td className="py-2.5 pr-3 text-amber-700 dark:text-amber-400">{entry.avoidOrCaution}</td>
                      <td className="py-2.5">
                        <Badge variant={licenseBadgeVariant(entry.licenseStatus)} className="text-[10px]">
                          {entry.licenseStatus}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ZeroTerminalDeployAssistant;
