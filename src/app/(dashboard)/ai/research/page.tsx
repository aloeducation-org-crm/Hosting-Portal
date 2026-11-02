"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/stores/authStore";

type ReviewRequest = { id: string; projectId: string; capability: string; targetKind: string; targetReference: string; targetSha256: string; objective: string; authorizationEvidence: string; scopeDigest: string; effectiveStatus: string; executionState: string; requestedBy: string; reviewReason: string | null; expiresAt: string | null };
type Project = { id: string; name: string };

export default function ResearchWorkspace() {
  const { user } = useAuthStore();
  const [records, setRecords] = useState<ReviewRequest[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ projectId: "", capability: "REVERSE_ENGINEERING", targetKind: "NATIVE_BINARY", targetReference: "", targetSha256: "", objective: "", authorizationEvidence: "", authorizedInspection: false });
  const load = useCallback(async () => {
    const response = await fetch("/api/ai/capability-requests", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.message || "Unable to load internal requests.");
    setRecords(json.data.requests); setProjects(json.data.projects);
  }, []);
  useEffect(() => { Promise.resolve().then(load).catch((cause) => setError(cause.message)); }, [load]);
  const submit = async (url: string, method: string, body: unknown) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.message || "Request failed.");
      setNotice(json.message); await load(); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); return false; }
    finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-6xl space-y-6 p-6">
    <header className="space-y-3"><p className="text-sm font-medium text-primary">INTERNAL • ADMINISTRATOR REVIEW</p><h1 className="text-3xl font-bold">AI Research &amp; Evolution</h1><p className="text-muted-foreground">Record an authorized target, define reconstruction or code-change scope, and obtain independent review.</p></header>
    <div className="rounded-xl border bg-muted/40 p-5 space-y-2 text-sm"><p><strong>Execution requires setup.</strong> Saving or approving a request does not run REA, fetch a website, inspect your Mac, send source to an AI provider, edit files or deploy code.</p><p>REA transport and proposal-generation libraries are implemented locally. A verified isolated runner, durable execution grants, Mac companion and voice integration are not enabled.</p><p>No DRM, licensing, authentication or access-control bypass. Do not enter credentials, private keys or customer secrets.</p></div>
    {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-lg border p-3">{notice}</p>}
    <form className="grid gap-4 rounded-xl border p-5 md:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); if (await submit("/api/ai/capability-requests", "POST", form)) setForm((previous) => ({ ...previous, objective: "", authorizationEvidence: "", authorizedInspection: false })); }}>
      <h2 className="text-xl font-semibold md:col-span-2">Create an inspection / change request</h2>
      <label className="space-y-1">Project<select required className="block w-full rounded-md border bg-background p-2" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">Select existing project</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
      <label className="space-y-1">Capability<select className="block w-full rounded-md border bg-background p-2" value={form.capability} onChange={(e) => setForm({ ...form, capability: e.target.value, targetKind: e.target.value === "CODE_EVOLUTION" ? "SOURCE_REPOSITORY" : "NATIVE_BINARY" })}><option value="REVERSE_ENGINEERING">Authorized reverse engineering</option><option value="CODE_EVOLUTION">Reviewed code evolution</option></select></label>
      <label className="space-y-1">Target type<select className="block w-full rounded-md border bg-background p-2" value={form.targetKind} onChange={(e) => setForm({ ...form, targetKind: e.target.value })}>{(form.capability === "CODE_EVOLUTION" ? ["SOURCE_REPOSITORY"] : ["NATIVE_BINARY", "WEBSITE", "MAC_APP", "SOURCE_REPOSITORY"]).map((kind) => <option value={kind} key={kind}>{kind.replaceAll("_", " ")}</option>)}</select></label>
      <label className="space-y-1">Target reference<Input required maxLength={400} value={form.targetReference} onChange={(e) => setForm({ ...form, targetReference: e.target.value })} placeholder="Owned app identifier, repository or HTTPS reference" /></label>
      <label className="space-y-1 md:col-span-2">Snapshot / artifact SHA-256<Input required pattern="[a-f0-9]{64}" maxLength={64} value={form.targetSha256} onChange={(e) => setForm({ ...form, targetSha256: e.target.value })} /><span className="text-xs text-muted-foreground">For websites/Mac apps use the authorized captured-evidence snapshot hash. This form does not capture or verify it; the future runner must independently verify the target.</span></label>
      <label className="space-y-1">Objective<textarea required minLength={10} maxLength={4000} className="block min-h-28 w-full rounded-md border bg-background p-2" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} /></label>
      <label className="space-y-1">Ownership / written authorization reference<textarea required minLength={10} maxLength={2000} className="block min-h-28 w-full rounded-md border bg-background p-2" value={form.authorizationEvidence} onChange={(e) => setForm({ ...form, authorizationEvidence: e.target.value })} /></label>
      <label className="flex items-start gap-2 text-sm md:col-span-2"><input required type="checkbox" checked={form.authorizedInspection} onChange={(e) => setForm({ ...form, authorizedInspection: e.target.checked })} />I confirm inspection is authorized and the scope excludes bypassing security protections. This is an attestation, not verified ownership or execution permission.</label>
      <Button disabled={busy || !projects.length} type="submit">Save for independent review</Button>
    </form>
    <section className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Latest requests</h2><Button disabled={busy} variant="outline" onClick={() => { setError(""); load().catch((cause) => setError(cause.message)); }}>Refresh</Button></div>
      {!records.length && <p className="text-sm text-muted-foreground">No requests loaded. If storage requires setup, the error above explains the failure; no task is running.</p>}
      {records.map((record) => <article key={record.id} className="space-y-3 rounded-xl border p-5">
        <div className="flex flex-wrap gap-3"><strong>{record.capability.replaceAll("_", " ")}</strong><span className="text-sm">{record.effectiveStatus}</span><span className="text-sm text-muted-foreground">{record.executionState.replaceAll("_", " ")}</span></div>
        <p className="break-all text-sm">{record.targetKind}: {record.targetReference}</p><p className="whitespace-pre-wrap text-sm">{record.objective}</p>
        <details className="text-sm"><summary>Scope and authorization record</summary><div className="mt-2 space-y-2 break-all"><p>Artifact: {record.targetSha256}</p><p>Scope: {record.scopeDigest}</p><p>Authorization: {record.authorizationEvidence}</p><p>Requester: {record.requestedBy}</p>{record.reviewReason && <p>Latest review: {record.reviewReason}</p>}{record.expiresAt && <p>Approval expires: {new Date(record.expiresAt).toLocaleString()}</p>}</div></details>
        {(record.effectiveStatus === "REQUESTED" || record.effectiveStatus === "APPROVED") && <div className="space-y-2"><label className="block text-sm">Review reason<Input minLength={10} maxLength={2000} value={reasons[record.id] || ""} onChange={(e) => setReasons({ ...reasons, [record.id]: e.target.value })} /></label><div className="flex flex-wrap gap-2">{(record.effectiveStatus === "REQUESTED" ? ["APPROVE", "REJECT"] : ["REVOKE"]).map((action) => <Button key={action} variant="outline" disabled={busy || (reasons[record.id] || "").trim().length < 10 || (action === "APPROVE" && user?.id === record.requestedBy)} onClick={() => submit(`/api/ai/capability-requests/${record.id}`, "PATCH", { action, scopeDigest: record.scopeDigest, reason: reasons[record.id], ...(action === "APPROVE" ? { validForMinutes: 15 } : {}) })}>{action === "APPROVE" ? "Approve scope for 15 minutes (not execution)" : action === "REJECT" ? "Reject" : "Revoke approval"}</Button>)}</div>{record.requestedBy === user?.id && record.effectiveStatus === "REQUESTED" && <p className="text-xs text-muted-foreground">A different authorized administrator must approve your request.</p>}</div>}
      </article>)}
    </section>
  </div>;
}
