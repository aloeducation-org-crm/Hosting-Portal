"use client";

import { useState } from "react";
import Link from "next/link";
import { SALES_CHANNELS, buildCampaignLink } from "@/lib/marketing/sales-channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SalesChannelsPage() {
  const [channel, setChannel] = useState<string>("website");
  const [destination, setDestination] = useState("");
  const [campaign, setCampaign] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="space-y-3">
        <p className="text-sm font-medium text-primary">GROWTH WORKSPACE</p>
        <h1 className="text-3xl font-bold">Sales channels</h1>
        <p className="text-muted-foreground">Plan your customer journey, prepare each channel and build consistent campaign links.</p>
        <p className="rounded-lg border bg-muted/40 p-4 text-sm">Planning tools only. No external accounts are connected here; publishing, sending, order sync and revenue reporting require real provider integrations. Form values are not saved.</p>
      </header>
      <section aria-label="Channel directory" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {SALES_CHANNELS.map((item) => <article key={item.id} className="space-y-3 rounded-xl border p-5">
          <span className="text-xs text-muted-foreground">Setup required</span>
          <h2 className="text-lg font-semibold">{item.name}</h2>
          <p className="text-sm">{item.description}</p>
          <p className="text-sm text-muted-foreground">{item.prerequisite}</p>
          <Button variant="outline" onClick={() => { setChannel(item.id); setResult(""); setError(""); }}>Use in link builder</Button>
        </article>)}
      </section>
      <section className="rounded-xl border p-6 space-y-4">
        <h2 className="text-xl font-semibold">Campaign link builder</h2>
        <p className="text-sm text-muted-foreground">Adds UTM parameters for attribution. This creates a link, not a campaign or a tracking service. Your destination analytics must collect these parameters.</p>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault(); setError(""); setResult("");
          try { setResult(buildCampaignLink(destination, channel, campaign)); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to build link."); }
        }} onChange={() => { setResult(""); setError(""); }}>
          <label className="block space-y-2"><span>Channel</span><select className="block w-full rounded-md border bg-background p-2" value={channel} onChange={(event) => setChannel(event.target.value)}>{SALES_CHANNELS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="block space-y-2"><span>Destination URL</span><Input required type="url" placeholder="https://example.com/offer" value={destination} onChange={(event) => setDestination(event.target.value)} /></label>
          <label className="block space-y-2"><span>Campaign name</span><Input required maxLength={120} placeholder="winter-launch" value={campaign} onChange={(event) => setCampaign(event.target.value)} /></label>
          <Button type="submit">Generate campaign link</Button>
        </form>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {result && <label className="block space-y-2"><span className="text-sm">Generated link — select and copy</span><Input aria-label="Generated campaign link" readOnly value={result} onFocus={(event) => event.target.select()} /></label>}
      </section>
      <footer className="flex flex-wrap gap-5 text-sm"><Link className="underline" href="/dashboard/crm">Open CRM</Link><Link className="underline" href="/dashboard/marketing">Digital marketing</Link><Link className="underline" href="/apps">App Center</Link></footer>
    </div>
  );
}
