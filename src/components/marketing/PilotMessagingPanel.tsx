"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Recipient = { id: string; channel: "EMAIL" | "SMS"; address: string; suppressedAt: string | null };
type Message = {
  id: string; channel: "EMAIL" | "SMS"; state: string; reason: string | null; createdAt: string;
  attempts: { provider: string; state: string; remoteId: string | null; httpStatus: number | null }[];
};
type Snapshot = { enabled: boolean; canManage: boolean; canQueue: boolean; recipients: Recipient[]; messages: Message[] };
const labels: Record<string, string> = {
  QUEUED: "Queued", SUBMITTING: "Submitting", ACCEPTED: "Provider accepted (not delivery)",
  SUPPRESSED: "Opted out", EXPIRED: "Queue expired", REJECTED: "Not submitted or refused", UNKNOWN: "Check with provider; do not resend",
  NO_FREE_CAPACITY: "No approved free route available",
};

export function PilotMessagingPanel() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [address, setAddress] = useState("");
  const [consentRef, setConsentRef] = useState("");
  const [optedIn, setOptedIn] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [text, setText] = useState("");
  const pendingSms = useRef<{ recipientId: string; text: string; requestId: string } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/marketing/messages", { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Messaging unavailable");
      if (!signal?.aborted) { setData(body.data); setError(""); }
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : "Messaging unavailable");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return load(controller.signal); });
    const timer = setInterval(() => void load(controller.signal), 8_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);

  async function post(body: object): Promise<boolean> {
    setBusy(true);
    try {
      const response = await fetch("/api/marketing/messages", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Request could not be recorded");
      toast.success(result.message);
      await load();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request could not be recorded");
      return false;
    } finally { setBusy(false); }
  }
  const smsRecipients = data?.recipients.filter((item) => item.channel === "SMS" && !item.suppressedAt) ?? [];

  if (!data?.enabled) return <p className="text-sm text-muted-foreground">{error || "Free-route delivery is restricted to the sister-company pilot. Drafts do not send email."}</p>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Free email & SMS pilot</CardTitle>
        <CardDescription>Only opted-in recipients and approved free routes. No paid fallback. A provider receipt is not delivery confirmation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {data.canManage && <form className="grid gap-2 border rounded-lg p-3" onSubmit={async (event) => {
          event.preventDefault();
          if (await post({ action: "record_consent", channel, address, consentRef, optedIn })) {
            setAddress(""); setConsentRef(""); setOptedIn(false);
          }
        }}>
          <Label htmlFor="pilot-channel">Record opt-in (super admin)</Label>
          <select id="pilot-channel" value={channel} onChange={(event) => setChannel(event.target.value === "SMS" ? "SMS" : "EMAIL")} className="rounded-md border p-2">
            <option value="EMAIL">Email marketing contact</option><option value="SMS">SMS pilot notices</option>
          </select>
          <Input aria-label="Recipient address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder={channel === "EMAIL" ? "name@company.example" : "+880…"} maxLength={254} required />
          <Input aria-label="Consent record reference" value={consentRef} onChange={(event) => setConsentRef(event.target.value)} placeholder="Reference to opt-in evidence (no secrets)" maxLength={160} minLength={3} required />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={optedIn} onChange={(event) => setOptedIn(event.target.checked)} required /> Recipient opted in to this channel and sender.</label>
          <Button type="submit" size="sm" disabled={busy || !optedIn}>Record consent</Button>
        </form>}
        {data.canQueue && <form className="grid gap-2 border rounded-lg p-3" onSubmit={async (event) => {
          event.preventDefault();
          const body = text.trim();
          if (!pendingSms.current || pendingSms.current.text !== body || pendingSms.current.recipientId !== recipientId) {
            pendingSms.current = { recipientId, text: body, requestId: crypto.randomUUID() };
          }
          if (await post({ action: "queue_sms", ...pendingSms.current })) { pendingSms.current = null; setText(""); }
        }}>
          <Label htmlFor="pilot-sms-recipient">Queue one pilot SMS</Label>
          <select id="pilot-sms-recipient" value={recipientId} onChange={(event) => setRecipientId(event.target.value)} className="rounded-md border p-2" required>
            <option value="">Select an opted-in number</option>
            {smsRecipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.address}</option>)}
          </select>
          <Textarea aria-label="SMS text" value={text} onChange={(event) => setText(event.target.value)} maxLength={160} placeholder="160 basic characters or 70 Unicode characters" required />
          <Button type="submit" size="sm" disabled={busy || !recipientId || !text.trim()}>Queue SMS</Button>
        </form>}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Pilot audience</h3>
          {!data.recipients.length && <p className="text-sm text-muted-foreground">No pilot recipients. A super administrator must record consent first.</p>}
          <ul className="max-h-64 overflow-auto divide-y">
            {data.recipients.map((recipient) => <li key={recipient.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>{recipient.channel} · {recipient.address}{recipient.suppressedAt ? " · Opted out" : ""}</span>
              {data.canManage && !recipient.suppressedAt && <Button variant="outline" size="sm" disabled={busy} onClick={() => {
                if (confirm(`Stop future ${recipient.channel} to ${recipient.address}?`)) void post({ action: "suppress", recipientId: recipient.id });
              }}>Suppress</Button>}
            </li>)}
          </ul>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Recent submissions</h3>
          {!data.messages.length && <p className="text-sm text-muted-foreground">No messages recorded.</p>}
          <ul className="max-h-80 overflow-auto divide-y">
            {data.messages.map((item) => <li key={item.id} className="py-2 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{item.channel}</Badge><span>{labels[item.state] ?? item.state}</span>
                <time dateTime={item.createdAt} className="text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</time>
              </div>
              <div className="font-mono text-muted-foreground break-all">{item.id}</div>
              {item.attempts.map((attempt) => <div key={attempt.provider} className="break-all">{attempt.provider} · {attempt.state}{attempt.httpStatus ? ` (${attempt.httpStatus})` : ""}{attempt.remoteId ? ` · ${attempt.remoteId}` : ""}</div>)}
            </li>)}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
