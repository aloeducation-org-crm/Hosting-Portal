"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Bot, CheckCircle2, Loader2, Play, ShieldCheck, Sparkles, Workflow, XCircle } from "lucide-react";

interface ChainProvider {
  id: string;
  label: string;
  tier: string;
  model: string;
  baseUrl: string;
  anonymous: boolean;
  hasKey: boolean;
  baseUrlVerified: boolean;
  notes: string;
}

interface ProviderStatus {
  ready: boolean;
  chain: ChainProvider[];
  skipped: Array<{ id: string; label: string; reason: string }>;
  warnings: string[];
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  sampleInput: unknown;
}

interface WorkflowSummary {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  nodes?: string | null;
  updatedAt: string;
  _count?: { runs: number };
}

interface StepResult {
  nodeId: string;
  type: string;
  label?: string;
  status: "succeeded" | "failed" | "skipped";
  output?: unknown;
  error?: string;
  skippedReason?: string;
  durationMs: number;
  provider?: string;
  model?: string;
  tokensUsed?: number;
}

interface RunResult {
  runId: string | null;
  status: "succeeded" | "failed";
  output: unknown;
  steps: StepResult[];
  error?: string | null;
  durationMs: number;
  aiCalls: number;
  tokensUsed: number;
  providers: string[];
}

function statusBadge(status: string) {
  if (status === "succeeded" || status === "ok") return <Badge variant="default">{status}</Badge>;
  if (status === "failed") return <Badge variant="destructive">{status}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export function AutomationsConsole() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState("{}");
  const [running, setRunning] = useState<"run" | "dry" | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probes, setProbes] = useState<Array<{ providerLabel: string; ok: boolean; latencyMs: number; model?: string; error?: string }>>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);

  const selected = useMemo(() => workflows.find((workflow) => workflow.id === selectedId) ?? null, [workflows, selectedId]);

  const load = useCallback(async () => {
    try {
      const [statusRes, templatesRes, workflowsRes] = await Promise.all([
        fetch("/api/ai/providers", { credentials: "include" }),
        fetch("/api/ai/workflows?templates=1", { credentials: "include" }),
        fetch("/api/ai/workflows", { credentials: "include" }),
      ]);
      const statusBody = await statusRes.json();
      const templatesBody = await templatesRes.json();
      const workflowsBody = await workflowsRes.json();
      if (statusBody.success) setStatus(statusBody.data);
      if (templatesBody.success) setTemplates(templatesBody.data.templates ?? []);
      if (workflowsBody.success) {
        const list: WorkflowSummary[] = workflowsBody.data.workflows ?? [];
        setWorkflows(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
      }
    } catch {
      toast.error("Failed to load AI automation status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const selectAutomation = (id: string) => {
    setSelectedId(id);
    setResult(null);
    const workflow = workflows.find((entry) => entry.id === id);
    const template = templates.find((entry) => entry.name === workflow?.name);
    setInput(template ? JSON.stringify(template.sampleInput ?? {}, null, 2) : "{}");
  };

  const createFromTemplate = async (templateId: string) => {
    try {
      const res = await fetch("/api/ai/workflows", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error?.details ?? body?.error?.code ?? "create failed");
      toast.success("Automation created");
      setWorkflows((current) => [body.data.workflow, ...current]);
      setSelectedId(body.data.workflow.id);
      setInput(JSON.stringify(templates.find((entry) => entry.id === templateId)?.sampleInput ?? {}, null, 2));
      setResult(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create automation");
    }
  };

  const createBlank = async () => {
    if (!newName.trim()) {
      toast.error("Give the automation a name");
      return;
    }
    try {
      const res = await fetch("/api/ai/workflows", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          nodes: [
            { id: "start", type: "trigger", label: "Manual run" },
            { id: "prompt", type: "ai.complete", label: "Ask the model", config: { prompt: "{{ input.message }}" } },
            { id: "out", type: "output", label: "Answer", config: { value: "{{ steps.prompt.output.text }}" } },
          ],
          edges: [
            { from: "start", to: "prompt" },
            { from: "prompt", to: "out" },
          ],
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error("create failed");
      setWorkflows((current) => [body.data.workflow, ...current]);
      setSelectedId(body.data.workflow.id);
      setNewName("");
      toast.success("Automation created");
    } catch {
      toast.error("Could not create automation");
    }
  };

  const run = async (dryRun: boolean) => {
    if (!selected) return;
    let parsedInput: unknown;
    try {
      parsedInput = input.trim() ? JSON.parse(input) : {};
    } catch {
      toast.error("Input must be valid JSON");
      return;
    }
    setRunning(dryRun ? "dry" : "run");
    setResult(null);
    try {
      const res = await fetch(`/api/ai/workflows/${selected.id}/run`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: parsedInput, dryRun }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.error?.message ?? body?.error?.code ?? "Run failed");
      const data = body.data as RunResult;
      setResult(data);
      if (data.status === "succeeded") toast.success(dryRun ? "Dry run passed" : "Automation finished");
      else toast.error(data.error ?? "Automation failed");
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Run failed");
    } finally {
      setRunning(null);
    }
  };

  const probe = async () => {
    setProbing(true);
    try {
      const res = await fetch("/api/ai/status?probe=1", { credentials: "include" });
      const body = await res.json();
      if (body.success) {
        setProbes(body.data.probes ?? []);
        toast.success(body.data.state === "HEALTHY" ? "At least one provider answered" : "No provider answered");
      } else {
        toast.error("Probe failed");
      }
    } catch {
      toast.error("Probe failed");
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Workflow className="h-6 w-6" /> AI automations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Server-side workflow execution against the configured provider chain. Tools are read-only (sites, SSL expiry,
          health); nothing here can restart a service or run a privileged helper.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" /> Provider chain
            </CardTitle>
            <CardDescription>
              Tried top to bottom until one answers. Configuration alone is not a health check.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={probe} disabled={probing}>
            {probing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Test live
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && status && !status.ready && (
            <Alert variant="destructive">
              <AlertTitle>No AI provider configured</AlertTitle>
              <AlertDescription>
                Set <code>LLM7_API_KEY</code> (free) or <code>UNOROUTER_API_KEY</code>, or enable anonymous free access with{" "}
                <code>AI_ALLOW_ANONYMOUS=true</code>. Automations will fail with 503 until then.
              </AlertDescription>
            </Alert>
          )}
          {status?.chain.map((provider) => (
            <div key={`${provider.id}-${provider.baseUrl}`} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
              <Badge variant={provider.tier === "free" ? "default" : provider.tier === "paid" ? "secondary" : "outline"}>
                {provider.tier}
              </Badge>
              <span className="font-medium">{provider.label}</span>
              <span className="text-muted-foreground">{provider.model}</span>
              <span className="text-muted-foreground">{provider.baseUrl}</span>
              {provider.anonymous && <Badge variant="outline">no key</Badge>}
              {!provider.baseUrlVerified && <Badge variant="destructive">unverified host</Badge>}
            </div>
          ))}
          {probes.map((entry) => (
            <div key={entry.providerLabel} className="flex items-center gap-2 text-sm">
              {entry.ok ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span>{entry.providerLabel}</span>
              <span className="text-muted-foreground">
                {entry.ok ? `${entry.latencyMs}ms · ${entry.model}` : entry.error}
              </span>
            </div>
          ))}
          {status?.warnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-600">
              {warning}
            </p>
          ))}
          {status?.skipped.length ? (
            <p className="text-xs text-muted-foreground">
              Skipped: {status.skipped.map((entry) => `${entry.id} (${entry.reason})`).join(", ")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Start from a template</CardTitle>
            <CardDescription>Each template uses real panel data and fails closed without an AI provider.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {templates.map((template) => (
              <div key={template.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{template.name}</span>
                  <Button size="sm" variant="outline" onClick={() => createFromTemplate(template.id)}>
                    <Sparkles className="mr-2 h-4 w-4" /> Use
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
              </div>
            ))}
            <div className="flex items-end gap-2 pt-2">
              <div className="flex-1">
                <Label htmlFor="automation-name">Blank automation</Label>
                <Input
                  id="automation-name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Ask the model anything"
                />
              </div>
              <Button onClick={createBlank}>Create</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Run an automation</CardTitle>
            <CardDescription>Input is passed to the workflow as JSON.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="automation-select">Automation</Label>
              <select
                id="automation-select"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={selectedId ?? ""}
                onChange={(event) => selectAutomation(event.target.value)}
              >
                <option value="">Select…</option>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name} ({workflow.status})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="automation-input">Input JSON</Label>
              <Textarea
                id="automation-input"
                className="min-h-[120px] font-mono text-xs"
                value={input}
                onChange={(event) => setInput(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => run(false)} disabled={!selected || running !== null}>
                {running === "run" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Run
              </Button>
              <Button variant="outline" onClick={() => run(true)} disabled={!selected || running !== null}>
                {running === "dry" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Dry run
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {result && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Run result {statusBadge(result.status)}
              </CardTitle>
              <CardDescription>
                {result.durationMs}ms · {result.aiCalls} AI call(s) · {result.tokensUsed} tokens
                {result.providers.length ? ` · ${result.providers.join(", ")}` : ""}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {result.error && (
              <Alert variant="destructive">
                <AlertTitle>Run failed</AlertTitle>
                <AlertDescription>{result.error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              {result.steps.map((step) => (
                <div key={`${step.nodeId}-${step.durationMs}`} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {statusBadge(step.status)}
                    <span className="font-medium">{step.label ?? step.nodeId}</span>
                    <span className="text-xs text-muted-foreground">
                      {step.type} · {step.durationMs}ms
                      {step.provider ? ` · ${step.provider}/${step.model ?? ""}` : ""}
                      {typeof step.tokensUsed === "number" && step.tokensUsed > 0 ? ` · ${step.tokensUsed} tokens` : ""}
                    </span>
                  </div>
                  {step.error && <p className="mt-1 text-xs text-destructive">{step.error}</p>}
                  {step.skippedReason && <p className="mt-1 text-xs text-muted-foreground">{step.skippedReason}</p>}
                  {step.output !== undefined && (
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                      {typeof step.output === "string" ? step.output : JSON.stringify(step.output, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Output</p>
              <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
                {typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
