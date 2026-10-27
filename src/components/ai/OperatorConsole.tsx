"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Activity,
  Bot,
  CheckCircle2,
  CreditCard,
  Cpu,
  Globe,
  Loader2,
  Megaphone,
  Play,
  Plus,
  Receipt,
  RefreshCw,
  Rocket,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface OperatorSnapshot {
  authMode: string;
  agent: {
    id: string;
    slug: string;
    name: string;
    status: string;
    capabilities: string[];
  };
  billing: {
    activeSubscription: { id: string; plan: string; status: string; amount: number } | null;
    plansCount: number;
    plans: Array<{ id: string; slug: string; name: string; priceMonthly: number; priceYearly: number }>;
    recentInvoices: Array<{ id: string; amount: number; currency: string; status: string; createdAt: string }>;
    ordersCount: number;
    paidRevenue: number;
    pendingBilling: number;
  };
  hosting: {
    serverHostname: string;
    serverIp: string;
    reservedControlPlanePort: number;
    nextAvailablePort: number;
    siteCount: number;
    websites: Array<{ id: string; name: string; domain: string; runtime: string; status: string; deployPort: number | null }>;
  };
  growth: {
    leadsCount: number;
    dealsCount: number;
    pipelineValue: number;
    campaignsCount: number;
    subscribersCount: number;
  };
  aiProviders: {
    defaultOrder: string[];
    openSourceConnectorsCount: number;
    openSourceExtensibility: string[];
  };
  recentRuns: Array<{
    id: string;
    input: string | null;
    output: string | null;
    durationMs: number | null;
    status: string;
    createdAt: string;
  }>;
}

interface OpenSourceConnector {
  id: string;
  engine: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  hasApiKey: boolean;
}

const SAMPLE_PROMPTS = [
  "বিল ও সিস্টেম স্ট্যাটাস রিপোর্ট দাও",
  "Activate premium plan for my account",
  "Generate invoice for $99",
  "crm-demo@alolabs.net নামে নতুন CRM লিড তৈরি করো",
  "ডিজিটাল মার্কেটিং ক্যাম্পেইন তৈরি করো",
];

export function OperatorConsole() {
  const [snapshot, setSnapshot] = useState<OperatorSnapshot | null>(null);
  const [connectors, setConnectors] = useState<OpenSourceConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  // Command composer
  const [prompt, setPrompt] = useState("");
  const [lastExecution, setLastExecution] = useState<{
    executedCommand: string;
    summaryBn: string;
    summaryEn: string;
    durationMs: number;
  } | null>(null);

  // Quick structured parameters
  const [deployDomain, setDeployDomain] = useState("portal-demo.alolabs.net");
  const [invoiceAmount, setInvoiceAmount] = useState("49");

  // Open-Source AI Provider Connector form
  const [ossEngine, setOssEngine] = useState<"ollama" | "localai" | "vllm" | "litellm" | "openwebui" | "gateway">("ollama");
  const [ossLabel, setOssLabel] = useState("Local Ollama Llama 3.3");
  const [ossBaseUrl, setOssBaseUrl] = useState("http://127.0.0.1:11434/v1");
  const [ossModel, setOssModel] = useState("llama3.3");
  const [ossApiKey, setOssApiKey] = useState("");
  const [savingOss, setSavingOss] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [opRes, provRes] = await Promise.all([
        fetch("/api/ai/operator", { credentials: "same-origin" }),
        fetch("/api/ai/providers", { credentials: "same-origin" }),
      ]);
      const opBody = await opRes.json();
      if (opRes.ok && opBody.success) {
        setSnapshot(opBody.data);
      }
      const provBody = await provRes.json();
      if (provRes.ok && provBody.success) {
        setConnectors(provBody.data.openSourceConnectors ?? []);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load Operator Console");
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

  const executeOperator = async (payload: {
    command: string;
    prompt?: string;
    params?: Record<string, unknown>;
  }) => {
    setRunning(true);
    try {
      const res = await fetch("/api/ai/operator", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.message || "Command execution failed");
      }
      setLastExecution(body.data);
      toast.success(body.data.summaryBn || body.data.summaryEn);
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Command failed");
    } finally {
      setRunning(false);
    }
  };

  const handleNaturalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    await executeOperator({ command: "natural_language", prompt: prompt.trim() });
    setPrompt("");
  };

  const handleRegisterOssProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingOss(true);
    try {
      const res = await fetch("/api/ai/providers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          engine: ossEngine,
          label: ossLabel,
          baseUrl: ossBaseUrl,
          defaultModel: ossModel,
          apiKey: ossApiKey || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "Failed to register open-source provider");
      toast.success(body.message || "Open-source AI provider registered!");
      setOssApiKey("");
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSavingOss(false);
    }
  };

  const handleProbeOss = async (id: string) => {
    setProbingId(id);
    try {
      const res = await fetch("/api/ai/providers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "probe", id }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "Probe failed");
      if (body.data.reachable) {
        toast.success(`Reachable (${body.data.latencyMs}ms) — Models: ${body.data.discoveredModels.join(", ") || "OK"}`);
      } else {
        toast.warning(`Endpoint offline (${body.data.reason || "connection refused"}) — saved config remains ready.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Probe error");
    } finally {
      setProbingId(null);
    }
  };

  const handleDeleteOss = async (id: string) => {
    try {
      const res = await fetch("/api/ai/providers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "Remove failed");
      toast.success("Open-source connector removed");
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-[#E8501A] text-white">Bill Agent AI — বিল এজেন্ট এআই</Badge>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">
              Autonomous Billing · Hosting · CRM · Digital Marketing
            </Badge>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-2">
            Master AI Operator & Open-Source Provider Hub
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Operate subscriptions, invoices, port-safe auto-deployments on <code className="font-mono">alo-server-lap</code>, CRM pipelines, and marketing campaigns in বাংলা or English — and connect any open-source AI engine.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/marketing">Digital Marketing</Link>
          </Button>
          <Button asChild size="sm" className="bg-[#E8501A] hover:bg-[#d14413] text-white">
            <Link href="/dashboard/billing">Billing Center</Link>
          </Button>
        </div>
      </div>

      {/* Live Snapshot KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between text-xs uppercase text-muted-foreground font-medium">
              <span>Active Plan & Revenue</span>
              <CreditCard className="h-4 w-4 text-[#E8501A]" />
            </div>
            <div className="text-2xl font-bold mt-2 capitalize">
              {snapshot?.billing.activeSubscription?.plan ?? "No Active Plan"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Paid: ${(snapshot?.billing.paidRevenue ?? 0).toFixed(2)} · Pending: ${(snapshot?.billing.pendingBilling ?? 0).toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between text-xs uppercase text-muted-foreground font-medium">
              <span>alo-server-lap Port Pool</span>
              <Server className="h-4 w-4 text-sky-600" />
            </div>
            <div className="text-2xl font-bold mt-2 font-mono">
              :{snapshot?.hosting.nextAvailablePort ?? 3062}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {snapshot?.hosting.siteCount ?? 0} sites · :3051 protected
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between text-xs uppercase text-muted-foreground font-medium">
              <span>CRM & Marketing</span>
              <Megaphone className="h-4 w-4 text-violet-600" />
            </div>
            <div className="text-2xl font-bold mt-2">
              {snapshot?.growth.campaignsCount ?? 0} Campaigns
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {snapshot?.growth.leadsCount ?? 0} leads · ${(snapshot?.growth.pipelineValue ?? 0).toLocaleString()} pipeline
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between text-xs uppercase text-muted-foreground font-medium">
              <span>AI Providers</span>
              <Cpu className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold mt-2">
              {(snapshot?.aiProviders.defaultOrder.length ?? 1) + connectors.length} Ready
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Default: {snapshot?.aiProviders.defaultOrder.join(" → ") ?? "llm7"} · {connectors.length} OSS custom
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="autopilot" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="autopilot" className="gap-1.5">
            <Bot className="h-3.5 w-3.5" /> Bill Agent AI (বিল এজেন্ট কমান্ড)
          </TabsTrigger>
          <TabsTrigger value="opensource" className="gap-1.5">
            <Cpu className="h-3.5 w-3.5" /> Open-Source AI Providers ({connectors.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" /> Execution Audit Trail ({snapshot?.recentRuns.length ?? 0})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Bill Agent AI Command Deck */}
        <TabsContent value="autopilot">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#E8501A]" />
                  Command Bill Agent AI (বাংলা অথবা English)
                </CardTitle>
                <CardDescription>
                  Supports natural-language instructions or programmatic <code className="font-mono">POST /api/ai/operator</code> with <code className="font-mono">Bearer &lt;API_KEY&gt;</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form onSubmit={handleNaturalSubmit} className="space-y-3">
                  <Textarea
                    rows={3}
                    placeholder="উদাহরণ: আমার জন্য Premium প্ল্যান চালু করো / Generate a $99 invoice / বিল ও সিস্টেম স্ট্যাটাস রিপোর্ট দাও..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {SAMPLE_PROMPTS.map((sp) => (
                      <button
                        key={sp}
                        type="button"
                        onClick={() => setPrompt(sp)}
                        className="text-xs px-2.5 py-1 rounded-full border hover:border-[#E8501A] hover:text-[#E8501A] transition-colors"
                      >
                        {sp}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="submit"
                    disabled={running || !prompt.trim()}
                    className="w-full bg-[#E8501A] hover:bg-[#d14413] text-white"
                  >
                    {running ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Executing via Bill Agent AI...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" /> Execute Autonomous Command
                      </>
                    )}
                  </Button>
                </form>

                {lastExecution && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-emerald-700 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4" /> Executed: {lastExecution.executedCommand}
                      </span>
                      <span className="text-xs text-muted-foreground">{lastExecution.durationMs}ms</span>
                    </div>
                    <p className="font-medium">{lastExecution.summaryBn}</p>
                    <p className="text-xs text-muted-foreground">{lastExecution.summaryEn}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle className="text-base">1-Click Autonomous Operations</CardTitle>
                <CardDescription>Trigger verified platform actions directly without typing.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={running}
                  onClick={() => void executeOperator({ command: "status_report" })}
                  className="w-full justify-start"
                >
                  <ShieldCheck className="h-4 w-4 mr-2 text-emerald-600" />
                  Run Full Billing & Infrastructure Audit
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  disabled={running}
                  onClick={() =>
                    void executeOperator({
                      command: "activate_plan",
                      params: { planSlug: "premium", billingCycle: "monthly" },
                    })
                  }
                  className="w-full justify-start"
                >
                  <CreditCard className="h-4 w-4 mr-2 text-[#E8501A]" />
                  Activate / Renew Hosting Plan + Paid Invoice
                </Button>

                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    value={invoiceAmount}
                    onChange={(e) => setInvoiceAmount(e.target.value)}
                    className="w-28"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={running}
                    onClick={() =>
                      void executeOperator({
                        command: "generate_invoice",
                        params: { amount: Number(invoiceAmount || 49), markPaid: false },
                      })
                    }
                    className="flex-1 justify-start"
                  >
                    <Receipt className="h-4 w-4 mr-2 text-amber-600" />
                    Issue Invoice ($)
                  </Button>
                </div>

                <div className="flex gap-2">
                  <Input
                    value={deployDomain}
                    onChange={(e) => setDeployDomain(e.target.value)}
                    placeholder="app.alolabs.net"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={running}
                    onClick={() =>
                      void executeOperator({
                        command: "auto_deploy_site",
                        params: { domain: deployDomain },
                      })
                    }
                    className="shrink-0"
                  >
                    <Rocket className="h-4 w-4 mr-1.5 text-sky-600" />
                    Deploy
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  disabled={running}
                  onClick={() =>
                    void executeOperator({
                      command: "launch_marketing_campaign",
                      params: { brandName: "ALO Labs", sendImmediately: false },
                    })
                  }
                  className="w-full justify-start"
                >
                  <Megaphone className="h-4 w-4 mr-2 text-violet-600" />
                  Auto-Generate 360° Marketing Campaign
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 2: Open-Source AI Provider Connector */}
        <TabsContent value="opensource">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle className="text-base">Connect Open-Source AI Provider</CardTitle>
                <CardDescription>
                  Plug in self-hosted Ollama, LocalAI, vLLM, LiteLLM, Open WebUI, or any OpenAI-compatible gateway while keeping built-in failover (<code className="font-mono">llm7</code>) intact.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRegisterOssProvider} className="space-y-3">
                  <div className="space-y-1">
                    <Label>Open-Source Engine</Label>
                    <Select value={ossEngine} onValueChange={(v) => setOssEngine(v as typeof ossEngine)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ollama">Ollama (OpenAI-compatible /v1)</SelectItem>
                        <SelectItem value="localai">LocalAI</SelectItem>
                        <SelectItem value="vllm">vLLM Server</SelectItem>
                        <SelectItem value="litellm">LiteLLM Proxy</SelectItem>
                        <SelectItem value="openwebui">Open WebUI API</SelectItem>
                        <SelectItem value="gateway">Custom OpenAI-Compatible Gateway</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Display Label</Label>
                    <Input value={ossLabel} onChange={(e) => setOssLabel(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Base URL</Label>
                    <Input value={ossBaseUrl} onChange={(e) => setOssBaseUrl(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Default Model ID</Label>
                    <Input value={ossModel} onChange={(e) => setOssModel(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Optional API Key (AES-256-GCM Encrypted at Rest)</Label>
                    <Input
                      type="password"
                      placeholder="Leave blank for local keyless Ollama/LocalAI"
                      value={ossApiKey}
                      onChange={(e) => setOssApiKey(e.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={savingOss} className="w-full bg-[#E8501A] hover:bg-[#d14413] text-white">
                    <Plus className="h-4 w-4 mr-1.5" /> Register Open-Source Provider
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle className="text-base">Registered Open-Source Connectors & Built-in Catalog</CardTitle>
                <CardDescription>
                  Test live <code className="font-mono">/v1/models</code> reachability or deploy containerized AI runtimes in <Link href="/ai/self-hosted" className="underline text-[#E8501A]">/ai/self-hosted</Link>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {connectors.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                    No custom open-source endpoints registered yet. Built-in <code className="font-mono">OLLAMA_BASE_URL</code>, <code className="font-mono">LOCALAI_BASE_URL</code>, <code className="font-mono">UNOROUTER_API_KEY</code>, <code className="font-mono">OKROUTER_API_KEY</code>, and <code className="font-mono">AI_GATEWAY_BASE_URL</code> remain active alongside custom connectors.
                  </div>
                ) : (
                  <div className="divide-y border rounded-lg">
                    {connectors.map((c) => (
                      <div key={c.id} className="p-3 text-xs flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-sm flex items-center gap-2">
                            {c.label}
                            <Badge variant="secondary">{c.engine}</Badge>
                          </div>
                          <div className="font-mono text-muted-foreground mt-0.5">
                            {c.baseUrl} · model: {c.defaultModel}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={probingId === c.id}
                            onClick={() => void handleProbeOss(c.id)}
                          >
                            <Play className="h-3.5 w-3.5 mr-1" /> Probe
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            onClick={() => void handleDeleteOss(c.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 3: Execution Audit Trail */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Bill Agent AI Executions</CardTitle>
              <CardDescription>Every command executed via UI or API Key is recorded in AiAgentRun & AuditLog.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y border rounded-lg">
                {(snapshot?.recentRuns ?? []).length === 0 ? (
                  <div className="p-6 text-xs text-muted-foreground text-center">
                    No autonomous executions recorded yet. Run a command in the first tab!
                  </div>
                ) : (
                  snapshot?.recentRuns.map((run) => (
                    <div key={run.id} className="p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline">{run.status}</Badge>
                        <span className="text-muted-foreground">
                          {run.durationMs ?? 0}ms · {new Date(run.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="font-medium whitespace-pre-line">{run.output}</div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
