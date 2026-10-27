"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  BarChart3,
  CheckCircle2,
  Copy,
  Globe,
  Link2,
  Loader2,
  Mail,
  Megaphone,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface MarketingMetrics {
  campaignCount: number;
  subscriberCount: number;
  leadCount: number;
  dealCount: number;
  pipelineValue: number;
  totalSent: number;
  avgOpenRate: number;
  avgClickRate: number;
}

interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  status: string;
  recipientCount: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  createdAt: string;
}

interface SubscriberRow {
  id: string;
  email: string;
  createdAt: string;
}

interface LeadRow {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  company: string | null;
  source: string | null;
  status: string;
}

interface SavedUtmRow {
  id: string;
  name: string;
  content: string | null;
  createdAt: string;
}

interface MarketingKit {
  brandName: string;
  language: "bn" | "en";
  aiEnhanced: boolean;
  aiProviderUsed: string | null;
  metaAds: Array<{ angle: string; headline: string; primaryText: string; cta: string }>;
  googleSearchAd: { headlines: string[]; descriptions: string[]; keywords: string[] };
  socialCalendar: Array<{ day: string; channel: string; format: string; hook: string; caption: string }>;
  emailBroadcast: { subject: string; previewText: string; htmlContent: string; textContent: string };
  landingPageCopy: { heroHeadline: string; heroSubheadline: string; valueBullets: string[]; primaryCta: string };
}

interface SeoResult {
  readinessScore: number;
  checks: Array<{ label: string; passed: boolean; recommendation: string }>;
  headTagsHtml: string;
  jsonLdScript: string;
  robotsTxt: string;
  sitemapXml: string;
}

export function DigitalMarketingHub() {
  const [activeTab, setActiveTab] = useState("ai-studio");
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<MarketingMetrics | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [subscribers, setSubscribers] = useState<SubscriberRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [savedUtms, setSavedUtms] = useState<SavedUtmRow[]>([]);

  // 1. AI Ad, Social & Copy Kit state
  const [brandName, setBrandName] = useState("ALO Labs");
  const [offerOrProduct, setOfferOrProduct] = useState("AI-Driven Cloud Hosting & Business Automation");
  const [targetAudience, setTargetAudience] = useState("স্টার্টআপ, ই-কমার্স ও ডিজিটাল এজেন্সি");
  const [landingUrl, setLandingUrl] = useState("https://alolabs.net");
  const [kitLoading, setKitLoading] = useState(false);
  const [kit, setKit] = useState<MarketingKit | null>(null);

  // 2. SEO & Schema state
  const [seoDomain, setSeoDomain] = useState("blog.alolabs.net");
  const [seoTitle, setSeoTitle] = useState("ALO Labs — Managed Cloud Hosting & AI Automation Platform");
  const [seoDesc, setSeoDesc] = useState(
    "Deploy Web, Server, and Mobile apps with zero terminal setup, automatic SSL, CRM, and full-funnel digital marketing tools.",
  );
  const [seoKeyword, setSeoKeyword] = useState("Cloud Hosting");
  const [seoLoading, setSeoLoading] = useState(false);
  const [seoResult, setSeoResult] = useState<SeoResult | null>(null);

  // 3. Email Broadcast & Audience state
  const [campName, setCampName] = useState("");
  const [campSubject, setCampSubject] = useState("");
  const [campBody, setCampBody] = useState("");
  const [sendNow, setSendNow] = useState(false);
  const [savingCamp, setSavingCamp] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [newSubscriberEmail, setNewSubscriberEmail] = useState("");

  // 4. UTM Builder state
  const [utmBase, setUtmBase] = useState("https://blog.alolabs.net");
  const [utmSource, setUtmSource] = useState("facebook");
  const [utmMedium, setUtmMedium] = useState("paid_social");
  const [utmCampaign, setUtmCampaign] = useState("q4_growth_launch");
  const [utmContent, setUtmContent] = useState("carousel_v1");
  const [generatedUtm, setGeneratedUtm] = useState("");

  // 5. Lead Capture -> CRM Pipeline state
  const [leadFirst, setLeadFirst] = useState("");
  const [leadLast, setLeadLast] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadCompany, setLeadCompany] = useState("");
  const [leadSource, setLeadSource] = useState("facebook_ads");
  const [leadDealTitle, setLeadDealTitle] = useState("");
  const [leadDealValue, setLeadDealValue] = useState("299");
  const [capturingLead, setCapturingLead] = useState(false);

  const loadHub = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing", { credentials: "same-origin" });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body?.message || "Failed to load Digital Marketing Hub");
      }
      setMetrics(body.data.metrics);
      setCampaigns(body.data.campaigns ?? []);
      setSubscribers(body.data.subscribers ?? []);
      setLeads(body.data.leads ?? []);
      setSavedUtms(body.data.savedUtmLinks ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load marketing data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) await loadHub();
    })();
    return () => {
      active = false;
    };
  }, [loadHub]);

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Clipboard copy blocked by browser");
    }
  };

  const handleGenerateKit = async (e: React.FormEvent) => {
    e.preventDefault();
    setKitLoading(true);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate_campaign_kit",
          brandName,
          offerOrProduct,
          targetAudience,
          landingUrl,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "Generation failed");
      setKit(body.data.kit);
      toast.success("360° Digital Marketing Kit generated!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate kit");
    } finally {
      setKitLoading(false);
    }
  };

  const handleSaveKitEmailAsCampaign = async () => {
    if (!kit) return;
    setSavingCamp(true);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_campaign",
          name: `${kit.brandName} Growth Broadcast`,
          subject: kit.emailBroadcast.subject,
          content: kit.emailBroadcast.htmlContent,
          textContent: kit.emailBroadcast.textContent,
          sendImmediately: false,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "Could not save campaign");
      toast.success("Saved to Email Campaigns! Switching to Broadcasts tab.");
      await loadHub();
      setActiveTab("broadcasts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save campaign");
    } finally {
      setSavingCamp(false);
    }
  };

  const handleRunSeoAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSeoLoading(true);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "seo_audit",
          domain: seoDomain,
          pageTitle: seoTitle,
          metaDescription: seoDesc,
          primaryKeyword: seoKeyword,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "SEO audit failed");
      setSeoResult(body.data.seo);
      toast.success(`SEO & Schema package ready (Score: ${body.data.seo.readinessScore}/100)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "SEO audit failed");
    } finally {
      setSeoLoading(false);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCamp(true);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_campaign",
          name: campName,
          subject: campSubject,
          textContent: campBody,
          content: `<div style="font-family:sans-serif;padding:20px">${campBody.replace(/\n/g, "<br/>")}</div>`,
          sendImmediately: sendNow,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "Failed to save campaign");
      toast.success(sendNow ? "Campaign dispatched!" : "Campaign saved as draft!");
      setCampName("");
      setCampSubject("");
      setCampBody("");
      await loadHub();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setSavingCamp(false);
    }
  };

  const handleDispatchCampaign = async (campaignId: string) => {
    setDispatchingId(campaignId);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dispatch_campaign", campaignId }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "Dispatch failed");
      toast.success(body.message || "Campaign sent!");
      await loadHub();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Dispatch failed");
    } finally {
      setDispatchingId(null);
    }
  };

  const handleAddSubscriber = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubscriberEmail.trim()) return;
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_subscriber", email: newSubscriberEmail.trim() }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "Could not add subscriber");
      toast.success("Subscriber added to audience");
      setNewSubscriberEmail("");
      await loadHub();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add subscriber");
    }
  };

  const handleRemoveSubscriber = async (id: string) => {
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_subscriber", id }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "Delete failed");
      toast.success("Subscriber removed");
      await loadHub();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleBuildUtm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "build_utm",
          baseUrl: utmBase,
          source: utmSource,
          medium: utmMedium,
          campaign: utmCampaign,
          content: utmContent || undefined,
          saveLink: true,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "Invalid URL");
      setGeneratedUtm(body.data.trackingUrl);
      toast.success("UTM tracking URL generated & saved!");
      await loadHub();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not build UTM link");
    }
  };

  const handleCaptureLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setCapturingLead(true);
    try {
      const res = await fetch("/api/marketing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "capture_lead",
          firstName: leadFirst,
          lastName: leadLast || undefined,
          email: leadEmail,
          company: leadCompany || undefined,
          source: leadSource,
          dealTitle: leadDealTitle || undefined,
          dealValue: leadDealValue ? Number(leadDealValue) : undefined,
          subscribeNewsletter: true,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body?.message || "Lead capture failed");
      toast.success("Lead synced to CRM Contacts, Pipeline Deals & Newsletter!");
      setLeadFirst("");
      setLeadLast("");
      setLeadEmail("");
      setLeadCompany("");
      setLeadDealTitle("");
      await loadHub();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lead capture failed");
    } finally {
      setCapturingLead(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge className="bg-[#E8501A] text-white">360° Digital Marketing Suite</Badge>
            <Badge variant="outline">SEO · Paid Ads · Social · Email · UTM · CRM Funnel</Badge>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-2">
            Digital Marketing Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Run your entire digital marketing operation from one place — AI ad copy, 7-day social calendars, technical SEO/Schema, email broadcasts, UTM attribution, and direct CRM pipeline capture.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadHub()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/crm">Open CRM Pipeline</Link>
          </Button>
          <Button asChild size="sm" className="bg-[#E8501A] hover:bg-[#d14413] text-white">
            <Link href="/ai/auto-deploy">
              <Rocket className="h-4 w-4 mr-1.5" /> Deploy Landing Page
            </Link>
          </Button>
        </div>
      </div>

      {/* Real DB Funnel KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between text-xs uppercase text-muted-foreground font-medium">
              <span>Audience & Leads</span>
              <Target className="h-4 w-4 text-[#E8501A]" />
            </div>
            <div className="text-2xl font-bold mt-2">
              {(metrics?.subscriberCount ?? 0) + (metrics?.leadCount ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics?.subscriberCount ?? 0} newsletter · {metrics?.leadCount ?? 0} CRM leads
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between text-xs uppercase text-muted-foreground font-medium">
              <span>Email Campaigns</span>
              <Mail className="h-4 w-4 text-sky-600" />
            </div>
            <div className="text-2xl font-bold mt-2">{metrics?.campaignCount ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics?.totalSent ?? 0} total emails dispatched
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between text-xs uppercase text-muted-foreground font-medium">
              <span>Engagement Rate</span>
              <BarChart3 className="h-4 w-4 text-violet-600" />
            </div>
            <div className="text-2xl font-bold mt-2">{metrics?.avgOpenRate ?? 0}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              Open rate · {metrics?.avgClickRate ?? 0}% CTR
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between text-xs uppercase text-muted-foreground font-medium">
              <span>Pipeline Revenue</span>
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold mt-2">
              ${(metrics?.pipelineValue ?? 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Across {metrics?.dealCount ?? 0} active CRM deal(s)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Marketing Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="ai-studio" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> AI Ads, Social & Copy
          </TabsTrigger>
          <TabsTrigger value="seo" className="gap-1.5">
            <Search className="h-3.5 w-3.5" /> SEO, Schema & Sitemap
          </TabsTrigger>
          <TabsTrigger value="broadcasts" className="gap-1.5">
            <Megaphone className="h-3.5 w-3.5" /> Email & Audience ({campaigns.length})
          </TabsTrigger>
          <TabsTrigger value="utm" className="gap-1.5">
            <Link2 className="h-3.5 w-3.5" /> UTM & Attribution ({savedUtms.length})
          </TabsTrigger>
          <TabsTrigger value="leads" className="gap-1.5">
            <UserPlus className="h-3.5 w-3.5" /> Lead Capture → CRM ({leads.length})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: AI Ads, Social Calendar & Copy Studio */}
        <TabsContent value="ai-studio">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle className="text-base">Generate 360° Campaign Kit (বাংলা / English)</CardTitle>
                <CardDescription>
                  Produces Meta/Facebook Ads, Google Search Ads, a 7-day social media calendar, email broadcast, and landing page copy.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleGenerateKit} className="space-y-3">
                  <div className="space-y-1">
                    <Label>Brand / Business Name</Label>
                    <Input value={brandName} onChange={(e) => setBrandName(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Product, Service or Offer</Label>
                    <Textarea rows={2} value={offerOrProduct} onChange={(e) => setOfferOrProduct(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Target Audience</Label>
                    <Input value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Landing Page URL</Label>
                    <Input value={landingUrl} onChange={(e) => setLandingUrl(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={kitLoading} className="w-full bg-[#E8501A] hover:bg-[#d14413] text-white">
                    {kitLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating Campaign Assets...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" /> Generate Full Marketing Kit
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle className="text-base">Generated Omnichannel Assets</CardTitle>
                <CardDescription>Copy any asset in 1 click or push the email directly into your Broadcast queue.</CardDescription>
              </CardHeader>
              <CardContent>
                {!kit ? (
                  <div className="border border-dashed rounded-xl p-8 text-center text-sm text-muted-foreground">
                    Click &ldquo;Generate Full Marketing Kit&rdquo; to create Meta ads, Google Search ads, a 7-day social media plan, and email copy.
                  </div>
                ) : (
                  <div className="space-y-4 max-h-[540px] overflow-y-auto pr-1">
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase text-muted-foreground">Meta (Facebook & Instagram) Ad Variations</div>
                      {kit.metaAds.map((ad) => (
                        <div key={ad.angle} className="rounded-lg border p-3 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <Badge variant="secondary">{ad.angle}</Badge>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs"
                              onClick={() => void copyText("Meta Ad", `${ad.headline}\n\n${ad.primaryText}\nCTA: ${ad.cta}`)}
                            >
                              <Copy className="h-3 w-3 mr-1" /> Copy
                            </Button>
                          </div>
                          <div className="font-semibold text-sm">{ad.headline}</div>
                          <p className="text-muted-foreground">{ad.primaryText}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-lg border p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold uppercase text-muted-foreground">Google Search Responsive Ad</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() =>
                            void copyText(
                              "Google Search Ad",
                              `Headlines: ${kit.googleSearchAd.headlines.join(" | ")}\nDescriptions: ${kit.googleSearchAd.descriptions.join(" / ")}\nKeywords: ${kit.googleSearchAd.keywords.join(", ")}`,
                            )
                          }
                        >
                          <Copy className="h-3 w-3 mr-1" /> Copy
                        </Button>
                      </div>
                      <div><strong>Headlines:</strong> {kit.googleSearchAd.headlines.join(" · ")}</div>
                      <div><strong>Descriptions:</strong> {kit.googleSearchAd.descriptions.join(" | ")}</div>
                      <div><strong>Keywords:</strong> {kit.googleSearchAd.keywords.join(", ")}</div>
                    </div>

                    <div className="rounded-lg border p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold uppercase text-muted-foreground">Email Broadcast Draft</span>
                        <Button
                          type="button"
                          size="sm"
                          disabled={savingCamp}
                          onClick={() => void handleSaveKitEmailAsCampaign()}
                          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <Mail className="h-3 w-3 mr-1" /> Save to Email Campaigns
                        </Button>
                      </div>
                      <div className="font-semibold">Subject: {kit.emailBroadcast.subject}</div>
                      <pre className="bg-muted p-2.5 rounded whitespace-pre-wrap font-sans text-xs">
                        {kit.emailBroadcast.textContent}
                      </pre>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold uppercase text-muted-foreground">7-Day Social Content Calendar</div>
                      {kit.socialCalendar.map((item) => (
                        <div key={item.day} className="rounded border px-3 py-2 text-xs flex items-start justify-between gap-2">
                          <div>
                            <span className="font-semibold">{item.day} ({item.channel} · {item.format}):</span>{" "}
                            <span>{item.hook}</span>
                            <div className="text-muted-foreground mt-0.5">{item.caption}</div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0"
                            onClick={() => void copyText(item.day, `${item.hook}\n\n${item.caption}`)}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 2: Technical SEO, OpenGraph, Schema.org & Sitemap */}
        <TabsContent value="seo">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle className="text-base">Technical SEO, OpenGraph & Schema Generator</CardTitle>
                <CardDescription>Audit metadata and generate ready-to-deploy HTML meta tags, JSON-LD, robots.txt, and sitemap.xml.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleRunSeoAudit} className="space-y-3">
                  <div className="space-y-1">
                    <Label>Domain</Label>
                    <Input value={seoDomain} onChange={(e) => setSeoDomain(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Primary Target Keyword</Label>
                    <Input value={seoKeyword} onChange={(e) => setSeoKeyword(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Page Title ({seoTitle.length}/60 chars)</Label>
                    <Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Meta Description ({seoDesc.length}/160 chars)</Label>
                    <Textarea rows={3} value={seoDesc} onChange={(e) => setSeoDesc(e.target.value)} required />
                  </div>
                  <Button type="submit" disabled={seoLoading} className="w-full bg-[#E8501A] hover:bg-[#d14413] text-white">
                    <Globe className="h-4 w-4 mr-2" /> Analyze SEO & Generate Tags
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle className="text-base">SEO Readiness & Generated Code</CardTitle>
              </CardHeader>
              <CardContent>
                {!seoResult ? (
                  <div className="border border-dashed rounded-xl p-8 text-center text-sm text-muted-foreground">
                    Run the SEO analyzer to inspect keyword placement and generate OpenGraph, JSON-LD Schema, robots.txt, and sitemap.xml.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                      <span className="text-sm font-semibold">On-Page SEO Readiness Score</span>
                      <Badge className="bg-emerald-600 text-white text-sm">{seoResult.readinessScore}/100</Badge>
                    </div>
                    <div className="space-y-1.5 text-xs">
                      {seoResult.checks.map((c) => (
                        <div key={c.label} className="flex items-start gap-2">
                          <CheckCircle2 className={`h-4 w-4 shrink-0 ${c.passed ? "text-emerald-600" : "text-amber-500"}`} />
                          <div>
                            <span className="font-medium">{c.label}:</span>{" "}
                            <span className="text-muted-foreground">{c.recommendation}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold">HTML &lt;head&gt; + JSON-LD Schema</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => void copyText("SEO Head + Schema", `${seoResult.headTagsHtml}\n${seoResult.jsonLdScript}`)}
                        >
                          <Copy className="h-3 w-3 mr-1" /> Copy Tags
                        </Button>
                      </div>
                      <pre className="text-[11px] font-mono bg-slate-950 text-slate-100 rounded-lg p-3 max-h-44 overflow-auto">
                        {`${seoResult.headTagsHtml}\n\n${seoResult.jsonLdScript}`}
                      </pre>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 3: Email Campaigns & Newsletter Audience */}
        <TabsContent value="broadcasts">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle className="text-base">Create Email Broadcast</CardTitle>
                <CardDescription>Send immediately or save as draft to your Newsletter + CRM Lead audience.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <form onSubmit={handleCreateCampaign} className="space-y-3">
                  <div className="space-y-1">
                    <Label>Campaign Name</Label>
                    <Input placeholder="October Product Update" value={campName} onChange={(e) => setCampName(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Email Subject Line</Label>
                    <Input placeholder="Introducing Zero-Terminal Auto-Deploy!" value={campSubject} onChange={(e) => setCampSubject(e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Message Body</Label>
                    <Textarea rows={4} placeholder="Write your announcement or offer..." value={campBody} onChange={(e) => setCampBody(e.target.value)} required />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={sendNow} onCheckedChange={setSendNow} id="send-now" />
                    <Label htmlFor="send-now" className="text-xs">Send immediately upon creation</Label>
                  </div>
                  <Button type="submit" disabled={savingCamp} className="w-full bg-[#E8501A] hover:bg-[#d14413] text-white">
                    <Send className="h-4 w-4 mr-2" /> {sendNow ? "Create & Dispatch Broadcast" : "Save Broadcast Draft"}
                  </Button>
                </form>

                <div className="border-t pt-4">
                  <form onSubmit={handleAddSubscriber} className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="Add subscriber email..."
                      value={newSubscriberEmail}
                      onChange={(e) => setNewSubscriberEmail(e.target.value)}
                      required
                    />
                    <Button type="submit" variant="outline">
                      <Plus className="h-4 w-4 mr-1" /> Add
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle className="text-base">Campaigns ({campaigns.length}) & Subscribers ({subscribers.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="divide-y border rounded-lg">
                  {campaigns.length === 0 ? (
                    <div className="p-4 text-xs text-muted-foreground text-center">No campaigns created yet.</div>
                  ) : (
                    campaigns.map((c) => (
                      <div key={c.id} className="p-3 flex items-center justify-between gap-2 text-xs">
                        <div>
                          <div className="font-semibold text-sm">{c.name}</div>
                          <div className="text-muted-foreground">Subject: {c.subject} · Recipients: {c.recipientCount}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{c.status}</Badge>
                          {c.status !== "sent" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={dispatchingId === c.id}
                              onClick={() => void handleDispatchCampaign(c.id)}
                            >
                              <Send className="h-3.5 w-3.5 mr-1" /> Send Now
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {subscribers.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Newsletter Subscribers</div>
                    <div className="max-h-40 overflow-y-auto divide-y border rounded-lg">
                      {subscribers.map((sub) => (
                        <div key={sub.id} className="px-3 py-2 text-xs flex items-center justify-between">
                          <span className="font-mono">{sub.email}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 text-red-600"
                            onClick={() => void handleRemoveSubscriber(sub.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 4: UTM Link & Attribution Builder */}
        <TabsContent value="utm">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle className="text-base">UTM Attribution URL Builder</CardTitle>
                <CardDescription>Track every ad click, social post, and email link cleanly across analytics.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleBuildUtm} className="space-y-3">
                  <div className="space-y-1">
                    <Label>Destination URL</Label>
                    <Input value={utmBase} onChange={(e) => setUtmBase(e.target.value)} required />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>utm_source</Label>
                      <Input value={utmSource} onChange={(e) => setUtmSource(e.target.value)} required />
                    </div>
                    <div className="space-y-1">
                      <Label>utm_medium</Label>
                      <Input value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} required />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>utm_campaign</Label>
                      <Input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} required />
                    </div>
                    <div className="space-y-1">
                      <Label>utm_content</Label>
                      <Input value={utmContent} onChange={(e) => setUtmContent(e.target.value)} />
                    </div>
                  </div>
                  <Button type="submit" className="w-full bg-[#E8501A] hover:bg-[#d14413] text-white">
                    <Link2 className="h-4 w-4 mr-2" /> Generate & Save UTM Link
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle className="text-base">Saved Attribution Links ({savedUtms.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {generatedUtm && (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs flex items-center justify-between gap-2">
                    <span className="font-mono break-all">{generatedUtm}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => void copyText("UTM URL", generatedUtm)}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                    </Button>
                  </div>
                )}
                <div className="divide-y border rounded-lg max-h-72 overflow-y-auto">
                  {savedUtms.length === 0 ? (
                    <div className="p-4 text-xs text-muted-foreground text-center">No UTM links saved yet.</div>
                  ) : (
                    savedUtms.map((u) => (
                      <div key={u.id} className="p-3 text-xs flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold">{u.name}</div>
                          <div className="font-mono text-muted-foreground truncate">{u.content}</div>
                        </div>
                        {u.content && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => void copyText("UTM URL", u.content!)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 5: Lead Capture -> CRM Contact + Deal */}
        <TabsContent value="leads">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle className="text-base">Capture Campaign Lead → CRM Pipeline</CardTitle>
                <CardDescription>Atomically creates a CRM Contact, optional Sales Deal, and Newsletter subscription.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCaptureLead} className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>First Name</Label>
                      <Input value={leadFirst} onChange={(e) => setLeadFirst(e.target.value)} required />
                    </div>
                    <div className="space-y-1">
                      <Label>Last Name</Label>
                      <Input value={leadLast} onChange={(e) => setLeadLast(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Email Address</Label>
                    <Input type="email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} required />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>Company</Label>
                      <Input value={leadCompany} onChange={(e) => setLeadCompany(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Attribution Source</Label>
                      <Input value={leadSource} onChange={(e) => setLeadSource(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2 space-y-1">
                      <Label>Optional Deal Title</Label>
                      <Input placeholder="Annual Hosting Retainer" value={leadDealTitle} onChange={(e) => setLeadDealTitle(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>Value ($)</Label>
                      <Input type="number" min="0" value={leadDealValue} onChange={(e) => setLeadDealValue(e.target.value)} />
                    </div>
                  </div>
                  <Button type="submit" disabled={capturingLead} className="w-full bg-[#E8501A] hover:bg-[#d14413] text-white">
                    <UserPlus className="h-4 w-4 mr-2" /> Sync Lead to CRM & Audience
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle className="text-base">Recent Marketing Leads ({leads.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y border rounded-lg max-h-80 overflow-y-auto">
                  {leads.length === 0 ? (
                    <div className="p-6 text-xs text-muted-foreground text-center">No leads captured yet.</div>
                  ) : (
                    leads.map((l) => (
                      <div key={l.id} className="p-3 text-xs flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-sm">
                            {l.firstName} {l.lastName ?? ""} {l.company ? `· ${l.company}` : ""}
                          </div>
                          <div className="text-muted-foreground">
                            {l.email ?? "No email"} · Source: <span className="font-mono">{l.source ?? "direct"}</span>
                          </div>
                        </div>
                        <Badge variant="outline">{l.status}</Badge>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
