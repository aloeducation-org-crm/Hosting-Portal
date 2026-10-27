/**
 * Must be the first import in this file: it points DATABASE_URL at a throwaway
 * copy of db/custom.db before `@/lib/db` is evaluated, so these tests cannot
 * write into the tracked development database. See tests/helpers/isolated-db.ts.
 */
import { teardownIsolatedDb } from "./helpers/isolated-db";
import crypto from "crypto";
import { describe, expect, it, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { resolveProviders } from "@/lib/ai/providers";
import {
  buildUtmTrackingUrl,
  generateMarketingKit,
  generateSeoPackage,
} from "@/lib/marketing/suite";
import { runWorkflowGraph } from "@/lib/ai/automation/engine";
import { HOSTING_TOOLS } from "@/lib/ai/automation/tools";
import { POST as postSubscription } from "@/app/api/subscriptions/route";
import { GET as getMarketing, POST as postMarketing } from "@/app/api/marketing/route";
import { GET as getOperator, POST as postOperator } from "@/app/api/ai/operator/route";
import { GET as getProviders, POST as postProviders } from "@/app/api/ai/providers/route";

async function buildAuthRequest(
  url: string,
  email: string,
  options?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<NextRequest> {
  const secret = process.env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET;
  const jwt = await encode({
    token: { email, sub: email },
    secret,
  });
  return new NextRequest(url, {
    method: options?.method ?? "GET",
    headers: {
      cookie: `next-auth.session-token=${jwt}`,
      ...(options?.body ? { "content-type": "application/json" } : {}),
      ...(options?.headers ?? {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
}

describe("Digital Marketing Command Center, Bill Agent AI Operator & Open-Source AI Providers", () => {
  const createdIds = {
    subscriptions: [] as string[],
    orders: [] as string[],
    invoices: [] as string[],
    campaigns: [] as string[],
    contacts: [] as string[],
    deals: [] as string[],
    newsletters: [] as string[],
    promptTemplates: [] as string[],
    secrets: [] as string[],
    apiKeys: [] as string[],
    websites: [] as string[],
    agentRuns: [] as string[],
  };

  afterAll(async () => {
    if (createdIds.agentRuns.length) {
      await db.aiAgentRun.deleteMany({ where: { id: { in: createdIds.agentRuns } } });
    }
    if (createdIds.websites.length) {
      await db.serverPort.deleteMany({ where: { websiteId: { in: createdIds.websites } } });
      await db.deployment.deleteMany({ where: { websiteId: { in: createdIds.websites } } });
      await db.domain.deleteMany({ where: { websiteId: { in: createdIds.websites } } });
      await db.website.deleteMany({ where: { id: { in: createdIds.websites } } });
    }
    if (createdIds.deals.length) {
      await db.crmDeal.deleteMany({ where: { id: { in: createdIds.deals } } });
    }
    if (createdIds.contacts.length) {
      await db.crmContact.deleteMany({ where: { id: { in: createdIds.contacts } } });
    }
    if (createdIds.campaigns.length) {
      await db.emailCampaign.deleteMany({ where: { id: { in: createdIds.campaigns } } });
    }
    if (createdIds.newsletters.length) {
      await db.newsletter.deleteMany({ where: { email: { in: createdIds.newsletters } } });
    }
    if (createdIds.promptTemplates.length) {
      await db.promptTemplate.deleteMany({ where: { id: { in: createdIds.promptTemplates } } });
    }
    if (createdIds.invoices.length) {
      await db.invoice.deleteMany({ where: { id: { in: createdIds.invoices } } });
    }
    if (createdIds.orders.length) {
      await db.order.deleteMany({ where: { id: { in: createdIds.orders } } });
    }
    if (createdIds.subscriptions.length) {
      await db.subscription.deleteMany({ where: { id: { in: createdIds.subscriptions } } });
    }
    if (createdIds.secrets.length) {
      await db.secret.deleteMany({ where: { id: { in: createdIds.secrets } } });
    }
    if (createdIds.apiKeys.length) {
      await db.apiKey.deleteMany({ where: { id: { in: createdIds.apiKeys } } });
    }
  });

  it("generates bilingual 360° marketing kits, SEO/Schema packages, and RFC-valid UTM URLs", async () => {
    const bnKit = await generateMarketingKit({
      brandName: "আলোল্যাবস",
      offerOrProduct: "ক্লাউড হোস্টিং ও এআই অটোমেশন",
      targetAudience: "বাংলাদেশের স্টার্টআপ ও এজেন্সি",
    });
    expect(bnKit.language).toBe("bn");
    expect(bnKit.metaAds).toHaveLength(3);
    expect(bnKit.socialCalendar).toHaveLength(7);
    expect(bnKit.emailBroadcast.htmlContent).toContain("আলোল্যাবস");

    const seo = generateSeoPackage({
      domain: "blog.alolabs.net",
      pageTitle: "ALO Cloud Hosting — Fast Managed Web & AI Hosting",
      metaDescription:
        "Launch modern web, API, and mobile apps on ALO Cloud Hosting with automated SSL, CRM, and digital marketing.",
      primaryKeyword: "Cloud Hosting",
    });
    expect(seo.readinessScore).toBe(100);
    expect(seo.headTagsHtml).toContain('rel="canonical" href="https://blog.alolabs.net/"');
    expect(seo.jsonLdScript).toContain('"@context": "https://schema.org"');
    expect(seo.sitemapXml).toContain("<loc>https://blog.alolabs.net/</loc>");

    const utm = buildUtmTrackingUrl({
      baseUrl: "blog.alolabs.net/pricing",
      source: "Facebook Ads",
      medium: "Paid Social",
      campaign: "Q4 Growth",
    });
    expect(utm).toBe(
      "https://blog.alolabs.net/pricing?utm_source=facebook_ads&utm_medium=paid_social&utm_campaign=q4_growth",
    );
  });

  it("activates hosting plans atomically via POST /api/subscriptions", async () => {
    const clientUser = await db.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: "desc" } });
    expect(clientUser).toBeTruthy();

    const req = await buildAuthRequest("http://localhost:3000/api/subscriptions", clientUser!.email, {
      method: "POST",
      body: { planSlug: "premium", billingCycle: "monthly" },
    });
    const res = await postSubscription(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.subscription.status).toBe("active");
    expect(body.data.invoice.status).toBe("paid");
    expect(body.data.order.status).toBe("completed");

    createdIds.subscriptions.push(body.data.subscription.id);
    createdIds.orders.push(body.data.order.id);
    createdIds.invoices.push(body.data.invoice.id);
  });

  it("operates end-to-end Digital Marketing workflows via /api/marketing", async () => {
    const user = await db.user.findFirst({ where: { isActive: true } });
    expect(user).toBeTruthy();

    // 1. Capture lead -> CRM Contact + Deal + Newsletter
    const uniqueEmail = `mkt-lead-${Date.now()}@alolabs.net`;
    const leadReq = await buildAuthRequest("http://localhost:3000/api/marketing", user!.email, {
      method: "POST",
      body: {
        action: "capture_lead",
        firstName: "Tanvir",
        lastName: "Ahmed",
        email: uniqueEmail,
        company: "Dhaka Digital",
        source: "meta_ads",
        dealTitle: "Dhaka Digital Cloud Migration",
        dealValue: 499,
        subscribeNewsletter: true,
      },
    });
    const leadRes = await postMarketing(leadReq);
    expect(leadRes.status).toBe(201);
    const leadJson = await leadRes.json();
    expect(leadJson.data.contact.email).toBe(uniqueEmail);
    expect(leadJson.data.deal.value).toBe(499);
    createdIds.contacts.push(leadJson.data.contact.id);
    createdIds.deals.push(leadJson.data.deal.id);
    createdIds.newsletters.push(uniqueEmail);

    // 2. Build & persist UTM link
    const utmReq = await buildAuthRequest("http://localhost:3000/api/marketing", user!.email, {
      method: "POST",
      body: {
        action: "build_utm",
        baseUrl: "https://alolabs.net",
        source: "linkedin",
        medium: "organic",
        campaign: "handover_launch",
        saveLink: true,
      },
    });
    const utmRes = await postMarketing(utmReq);
    const utmJson = await utmRes.json();
    expect(utmRes.status).toBe(200);
    expect(utmJson.data.savedRecord.id).toBeTruthy();
    createdIds.promptTemplates.push(utmJson.data.savedRecord.id);

    // 3. Create & dispatch email broadcast
    const campReq = await buildAuthRequest("http://localhost:3000/api/marketing", user!.email, {
      method: "POST",
      body: {
        action: "create_campaign",
        name: "Test Growth Broadcast",
        subject: "Welcome to ALO Growth",
        textContent: "Hello subscribers!",
        sendImmediately: false,
      },
    });
    const campRes = await postMarketing(campReq);
    expect(campRes.status).toBe(201);
    const campJson = await campRes.json();
    createdIds.campaigns.push(campJson.data.campaign.id);

    const dispReq = await buildAuthRequest("http://localhost:3000/api/marketing", user!.email, {
      method: "POST",
      body: { action: "dispatch_campaign", campaignId: campJson.data.campaign.id },
    });
    const dispRes = await postMarketing(dispReq);
    const dispJson = await dispRes.json();
    expect(dispRes.status).toBe(200);
    expect(dispJson.data.campaign.status).toBe("sent");

    // 4. GET /api/marketing metrics
    const getReq = await buildAuthRequest("http://localhost:3000/api/marketing", user!.email);
    const getRes = await getMarketing(getReq);
    const getJson = await getRes.json();
    expect(getRes.status).toBe(200);
    expect(getJson.data.metrics.campaignCount).toBeGreaterThanOrEqual(1);
  });

  it("operates the platform autonomously via Bill Agent AI (/api/ai/operator) using both Session and Headless API Key", async () => {
    const admin = await db.user.findFirst({
      where: { isActive: true, role: { name: { in: ["SUPER_ADMIN", "ADMIN"] } } },
    });
    expect(admin).toBeTruthy();

    // Create temporary API key for headless Bill Agent AI test
    const rawKey = `alo_live_${crypto.randomBytes(24).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const apiKeyRow = await db.apiKey.create({
      data: {
        userId: admin!.id,
        name: "Bill Agent AI Test Key",
        keyHash,
        prefix: rawKey.slice(0, 12),
      },
    });
    createdIds.apiKeys.push(apiKeyRow.id);

    // 1. Headless GET /api/ai/operator via Bearer API key
    const snapReq = new NextRequest("http://localhost:3000/api/ai/operator", {
      headers: { authorization: `Bearer ${rawKey}` },
    });
    const snapRes = await getOperator(snapReq);
    const snapJson = await snapRes.json();
    expect(snapRes.status).toBe(200);
    expect(snapJson.data.authMode).toBe("api_key");
    expect(snapJson.data.hosting.reservedControlPlanePort).toBe(3051);
    expect(snapJson.data.hosting.nextAvailablePort).toBeGreaterThanOrEqual(3062);

    // 2. Headless invoice generation + mark paid
    const invReq = new NextRequest("http://localhost:3000/api/ai/operator", {
      method: "POST",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "generate_invoice",
        params: { amount: 79, markPaid: false },
      }),
    });
    const invRes = await postOperator(invReq);
    const invJson = await invRes.json();
    expect(invRes.status).toBe(200);
    expect(invJson.data.result.invoice.status).toBe("pending");
    createdIds.invoices.push(invJson.data.result.invoice.id);

    const payReq = new NextRequest("http://localhost:3000/api/ai/operator", {
      method: "POST",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "mark_invoice_paid",
        params: { invoiceId: invJson.data.result.invoice.id },
      }),
    });
    const payRes = await postOperator(payReq);
    const payJson = await payRes.json();
    expect(payRes.status).toBe(200);
    expect(payJson.data.result.invoice.status).toBe("paid");

    // 3. Auto-deploy site via Bengali natural language prompt & protect hosting.alolabs.net
    const blockedReq = new NextRequest("http://localhost:3000/api/ai/operator", {
      method: "POST",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "auto_deploy_site",
        params: { domain: "hosting.alolabs.net" },
      }),
    });
    const blockedRes = await postOperator(blockedReq);
    expect(blockedRes.status).toBe(400);

    const testDomain = `billagent-${Date.now()}.alolabs.net`;
    const deployReq = new NextRequest("http://localhost:3000/api/ai/operator", {
      method: "POST",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "natural_language",
        prompt: `${testDomain} সাইটটি অটো-ডিপ্লয় করো`,
      }),
    });
    const deployRes = await postOperator(deployReq);
    const deployJson = await deployRes.json();
    expect(deployRes.status).toBe(200);
    expect(deployJson.data.executedCommand).toBe("auto_deploy_site");
    expect(deployJson.data.result.website.applicationPort).toBeGreaterThanOrEqual(3062);
    createdIds.websites.push(deployJson.data.result.website.id);

    const latestRuns = await db.aiAgentRun.findMany({
      where: { model: "alo-bill-ops-autopilot", userId: admin!.id },
      orderBy: { createdAt: "desc" },
      take: 4,
    });
    expect(latestRuns.length).toBeGreaterThanOrEqual(3);
    createdIds.agentRuns.push(...latestRuns.map((r) => r.id));
  });

  it("preserves default AI provider chain and manages Open-Source AI connectors securely", async () => {
    // Must-preserve invariant: resolveProviders({}) active providers -> ['llm7']
    const defaultRes = resolveProviders({});
    expect(defaultRes.providers.map((p) => p.id)).toEqual(["llm7"]);

    const admin = await db.user.findFirst({
      where: { isActive: true, role: { name: { in: ["SUPER_ADMIN", "ADMIN"] } } },
    });
    const client = await db.user.findFirst({
      where: { isActive: true, role: { name: "CLIENT" } },
    });
    expect(admin).toBeTruthy();

    // Block cloud metadata SSRF
    const ssrfReq = await buildAuthRequest("http://localhost:3000/api/ai/providers", admin!.email, {
      method: "POST",
      body: {
        action: "register",
        engine: "ollama",
        label: "Bad Metadata",
        baseUrl: "http://169.254.169.254/latest/meta-data",
        defaultModel: "llama3.3",
      },
    });
    const ssrfRes = await postProviders(ssrfReq);
    expect(ssrfRes.status).toBe(400);

    // Register local Ollama connector
    const regReq = await buildAuthRequest("http://localhost:3000/api/ai/providers", admin!.email, {
      method: "POST",
      body: {
        action: "register",
        engine: "ollama",
        label: "Self-Hosted Ollama Node",
        baseUrl: "http://127.0.0.1:11434/v1",
        defaultModel: "qwen2.5-coder:14b",
        apiKey: "oss-test-secret-token",
      },
    });
    const regRes = await postProviders(regReq);
    const regJson = await regRes.json();
    expect(regRes.status).toBe(201);
    expect(JSON.stringify(regJson)).not.toContain("oss-test-secret-token");
    const connectorId = regJson.data.connector.id as string;
    createdIds.secrets.push(connectorId);

    // Non-admin CLIENT receives masked internal URL and is forbidden from mutating providers
    if (client) {
      const clientGet = await getProviders(
        await buildAuthRequest("http://localhost:3000/api/ai/providers", client.email),
      );
      const clientJson = await clientGet.json();
      const matched = clientJson.data.openSourceConnectors.find(
        (c: { id: string }) => c.id === connectorId,
      );
      expect(matched.baseUrl).toBe("internal-endpoint (redacted)");

      const clientPost = await postProviders(
        await buildAuthRequest("http://localhost:3000/api/ai/providers", client.email, {
          method: "POST",
          body: { action: "delete", id: connectorId },
        }),
      );
      expect(clientPost.status).toBe(403);
    }

    // Delete cleanly as admin
    const delRes = await postProviders(
      await buildAuthRequest("http://localhost:3000/api/ai/providers", admin!.email, {
        method: "POST",
        body: { action: "delete", id: connectorId },
      }),
    );
    expect(delRes.status).toBe(200);
    createdIds.secrets = createdIds.secrets.filter((id) => id !== connectorId);
  });

  it("executes hosting.billingOverview and hosting.marketingOverview DAG nodes with fail-closed tenant isolation", async () => {
    const admin = await db.user.findFirst({ where: { isActive: true } });
    expect(admin).toBeTruthy();

    // Fail-closed without actor
    const failedRun = await runWorkflowGraph(
      {
        nodes: [{ id: "bill", type: "hosting.billingOverview" }],
        edges: [],
      },
      {
        ai: async () => ({ text: "{}", provider: "mock", model: "mock", tokensUsed: 0 }),
        tools: HOSTING_TOOLS,
      },
      {},
    );
    expect(failedRun.status).toBe("failed");

    // Succeeds with authenticated actor
    const okRun = await runWorkflowGraph(
      {
        nodes: [
          { id: "bill", type: "hosting.billingOverview" },
          { id: "mkt", type: "hosting.marketingOverview" },
        ],
        edges: [{ from: "bill", to: "mkt" }],
      },
      {
        ai: async () => ({ text: "{}", provider: "mock", model: "mock", tokensUsed: 0 }),
        tools: HOSTING_TOOLS,
      },
      { actor: { userId: admin!.id, isAdmin: false } },
    );
    expect(okRun.status).toBe("succeeded");
    expect(okRun.steps).toHaveLength(2);
  });
});

/** Delete this file's scratch database copy. */
afterAll(async () => {
  await teardownIsolatedDb();
});
