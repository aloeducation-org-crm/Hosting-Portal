"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, GitBranch, Globe, RefreshCw, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Site {
  id: string;
  ownerId?: string;
  hostname: string;
  repository: string;
  branch: string | null;
  commitSha: string | null;
  jobId: string | null;
  status: string;
  progress: number;
  events: Array<{ at: string; percent: number; message: string }>;
  error: string | null;
  originVerifiedAt: string | null;
  files: number | null;
  bytes: number | null;
  public: { status: string; checkedAt: string; url?: string } | null;
  verificationJobStatus: string | null;
  verificationError: string | null;
  withdrawnAt: string | null;
  withdrawalStatus: string | null;
  withdrawalError: string | null;
}

interface HostingStatus {
  domain: string | null;
  canDeploy: boolean;
  publicCheckConfigured: boolean;
  limits: { files: number; fileBytes: number; releaseBytes: number };
  plan: { id: string; name: string; maxSites: number; usedSites: number } | null;
  sites: Site[];
}

const busyStates = new Set(["REQUESTED", "QUEUED", "VALIDATING", "RUNNING", "RETRYING", "VERIFYING", "ROLLING_BACK"]);
const publicLabels: Record<string, string> = {
  NOT_CONFIGURED: "Public ingress is not configured", DNS_NOT_VERIFIED: "DNS not verified",
  HTTPS_NOT_VERIFIED: "HTTPS did not serve the expected release", VERIFIED: "HTTPS verified",
  CHECK_REQUIRED: "A fresh HTTPS check is required",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || `Request failed (HTTP ${response.status})`);
  return body.data;
}

export function StaticHostingManager({ operator = false }: { operator?: boolean }) {
  const [data, setData] = useState<HostingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [form, setForm] = useState({ repository: "", branch: "", label: "", planId: "", confirmPublish: false });
  const pending = useRef<{ body: string; requestId: string } | null>(null);
  const refresh = useCallback(async () => {
    try { setData(await api<HostingStatus>(operator ? "/api/deploy/static?scope=all" : "/api/deploy/static")); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to read hosting status"); }
  }, [operator]);

  useEffect(() => { const t = setTimeout(() => void refresh(), 0); return () => clearTimeout(t); }, [refresh]);
  const polling = Boolean(data?.sites.some((site) => busyStates.has(site.status) || (busyStates.has(site.verificationJobStatus ?? "") || busyStates.has(site.withdrawalStatus ?? ""))));
  const hasVerifiedLink = Boolean(data?.sites.some((site) => site.public?.url));
  useEffect(() => {
    if (!polling && !hasVerifiedLink) return;
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, polling ? 4_000 : 60_000);
    return () => clearInterval(t);
  }, [polling, hasVerifiedLink, refresh]);

  async function deploy(event: FormEvent) {
    event.preventDefault();
    if (operator || !form.confirmPublish || !form.planId || action) return;
    const fields = { ...form, branch: form.branch.trim() || undefined };
    const body = JSON.stringify(fields);
    if (pending.current?.body !== body) pending.current = { body, requestId: crypto.randomUUID() };
    setAction("deploy");
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ hostname: string }>("/api/deploy/static", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, requestId: pending.current.requestId }),
      });
      pending.current = null;
      setNotice(`Request saved for ${result.hostname}. A worker will pick it up for verification.`);
      setForm({ repository: "", branch: "", label: "", planId: "", confirmPublish: false });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start deployment"); }
    finally { setAction(null); }
  }

  async function recheck(site: Site) {
    setAction(site.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/deploy/static/${site.id}/verify`, { method: "POST" });
      setNotice(`HTTPS check queued for ${site.hostname}.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not queue HTTPS check"); }
    finally { setAction(null); }
  }

  async function withdraw(event: FormEvent<HTMLFormElement>, site: Site) {
    event.preventDefault();
    const confirmHostname = new FormData(event.currentTarget).get("confirmHostname");
    setAction(site.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/deploy/static/${site.id}/withdraw`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmHostname }) });
      setNotice(`Withdrawal queued for ${site.hostname}. Files are retained.`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not queue withdrawal"); }
    finally { setAction(null); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <Button size="sm" variant="ghost" asChild><Link href={operator ? "/automation" : "/deployments"}><ArrowLeft /> {operator ? "Automation Center" : "Git Deployments"}</Link></Button>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#E8501A]">Hosting / Static sites</div>
          <h1 className="text-3xl font-semibold tracking-tight">{operator ? "Static hosting operations" : "Deploy a static website"}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">{operator ? "Review up to 100 recent site requests, their durable jobs and observed serving status. This view cannot publish on a customer’s behalf." : "Publish a public GitHub repository on a managed domain. ALO pins the commit, validates the files and checks what the hosting edge actually serves."}</p>
        </div>
        <Button variant="outline" onClick={() => { setError(null); void refresh(); }}><RefreshCw /> Refresh</Button>
      </header>
      {error && <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive" role="alert">{error}</p>}
      {notice && <p className="rounded-md border px-4 py-3 text-sm" role="status">{notice}</p>}
      {!data && !error && <p className="text-sm text-muted-foreground" role="status">Loading hosting status…</p>}
      {data && !data.domain && <Card><CardHeader><CardTitle>Setup required</CardTitle><CardDescription>Managed static hosting is not configured on this installation. No site can be queued until the operator enables it.</CardDescription></CardHeader></Card>}
      {data?.domain && <div className={operator ? "max-w-4xl" : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]"}>
        {!operator && <Card className="self-start">
          <CardHeader><CardTitle>New deployment</CardTitle><CardDescription>Build-free HTML, CSS, JavaScript and common image and font files. Private repositories and applications that require a build are not supported here.</CardDescription></CardHeader>
          <CardContent>
            {!data.canDeploy ? <p className="text-sm text-muted-foreground">A verified account with website create and deploy permissions is required.</p> : <form className="space-y-4" onSubmit={deploy}>
              <div className="space-y-2"><Label htmlFor="static-repo">Public GitHub repository</Label><Input id="static-repo" required maxLength={240} placeholder="owner/repository" value={form.repository} onChange={(e) => setForm({ ...form, repository: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="static-branch">Branch <span className="text-xs text-muted-foreground">(optional)</span></Label><Input id="static-branch" maxLength={120} placeholder="Repository default" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="static-hostname">Managed hostname</Label><Input id="static-hostname" required maxLength={45} placeholder="my-website" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value.toLowerCase() })} aria-describedby="static-hostname-zone" /><p className="break-all text-xs text-muted-foreground" id="static-hostname-zone">{form.label || "my-website"}.{data.domain}</p></div>
              <div className="space-y-2">
                <Label htmlFor="static-plan">Hosting plan</Label>
                <select id="static-plan" required className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
                  <option value="">Select your active plan</option>
                  {data.plan && <option value={data.plan.id}>{data.plan.name} ({data.plan.usedSites}/{data.plan.maxSites} sites used)</option>}
                </select>
                <p className="text-xs text-muted-foreground">Deployment does not purchase infrastructure or change your plan. <Link className="underline" href="/billing">Manage plans in Billing</Link></p>
              </div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" required className="mt-1" checked={form.confirmPublish} onChange={(e) => setForm({ ...form, confirmPublish: e.target.checked })} /> I’m authorized to publish these repository files publicly on this domain.</label>
              <Button type="submit" disabled={Boolean(action) || !form.confirmPublish || !data.plan || data.plan.usedSites >= data.plan.maxSites}><Rocket />{action === "deploy" ? "Saving request…" : "Deploy website"}</Button>
              <p className="text-xs text-muted-foreground">Include a root index.html. Limit: {data.limits.files} files, {data.limits.releaseBytes / (1024 ** 2)} MiB total.</p>
            </form>}
          </CardContent>
        </Card>}
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Globe className="h-5 w-5" /> {operator ? "Recent site requests" : "Your static sites"}</h2>
          {!data.sites.length && <p className="rounded-lg border p-4 text-sm text-muted-foreground">No requests have been recorded yet.</p>}
          {data.sites.map((site) => <Card key={site.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="break-all text-base">{site.hostname}</CardTitle><Badge variant="outline">{site.withdrawnAt ? "Withdrawn" : busyStates.has(site.withdrawalStatus ?? "") ? "Withdrawing" : site.originVerifiedAt ? "Origin verified" : site.status.replaceAll("_", " ")}</Badge></div>
              <CardDescription className="flex flex-wrap items-center gap-1"><GitBranch className="h-3 w-3" /> {site.repository}{site.branch ? ` · ${site.branch}` : ""}{site.commitSha && <> · <code>{site.commitSha.slice(0, 12)}</code></>}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {site.ownerId && <p className="break-all text-xs text-muted-foreground">Customer ID <code>{site.ownerId}</code></p>}
              {busyStates.has(site.status) && <progress className="h-2 w-full" aria-label="Deployment progress" max={100} value={site.progress} />}
              {site.error && <p className="text-destructive">{site.error}</p>}
              {site.originVerifiedAt && <p className="text-muted-foreground">Verified at the origin on {new Date(site.originVerifiedAt).toLocaleString()} · {site.files} files, {site.bytes?.toLocaleString()} bytes</p>}
              {site.public?.url ? <a className="inline-flex items-center gap-1 font-medium underline" href={site.public.url} target="_blank" rel="noopener noreferrer">Open verified site <ExternalLink className="h-3 w-3" /></a> : <p className="text-muted-foreground">{site.public ? publicLabels[site.public.status] : "No verified public URL"}.</p>}
              {site.public && <p className="text-xs text-muted-foreground">Last ingress check: {new Date(site.public.checkedAt).toLocaleString()}</p>}
              {site.verificationError && <p className="text-destructive">Latest check: {site.verificationError}</p>}
              {!operator && site.originVerifiedAt && !site.withdrawalStatus && data.publicCheckConfigured && <Button size="sm" variant="outline" onClick={() => void recheck(site)} disabled={Boolean(action) || busyStates.has(site.verificationJobStatus ?? "")}><RefreshCw />{busyStates.has(site.verificationJobStatus ?? "") ? "HTTPS check queued or running" : "Recheck HTTPS"}</Button>}
              {site.withdrawalError && <p className="text-destructive">Withdrawal: {site.withdrawalError}</p>}
              {site.withdrawnAt && <p className="text-muted-foreground">Removed from the origin on {new Date(site.withdrawnAt).toLocaleString()}. Files were not deleted.</p>}
              {!operator && !site.withdrawnAt && !site.withdrawalStatus && !busyStates.has(site.status) && site.status !== "WAITING_APPROVAL" && <details className="text-muted-foreground">
                <summary className="cursor-pointer">Withdraw website</summary>
                <form className="mt-2 space-y-2" onSubmit={(event) => void withdraw(event, site)}>
                  <Label htmlFor={`withdraw-${site.id}`}>Type {site.hostname} to stop serving this site.</Label>
                  <Input id={`withdraw-${site.id}`} name="confirmHostname" required maxLength={253} autoComplete="off" />
                  <Button variant="outline" size="sm" disabled={Boolean(action)}>Confirm withdrawal</Button>
                </form>
              </details>}
              {site.events.length > 0 && <details className="text-muted-foreground">
                <summary className="cursor-pointer">Deployment report</summary>
                <ol className="mt-2 space-y-1 border-l pl-3 text-xs">
                  {site.events.map((event, index) => <li key={`${event.at}-${index}`}><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time> · {event.message}</li>)}
                </ol>
              </details>}
              {site.jobId && <p className="break-all text-xs text-muted-foreground">Job <code>{site.jobId}</code></p>}
            </CardContent>
          </Card>)}
        </div>
      </div>}
    </div>
  );
}
