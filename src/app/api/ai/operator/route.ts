import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, isAdminRole, type AuthUser } from "@/lib/auth";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";
import { createAuditLog } from "@/lib/audit";
import { ensureDefaultAgentsSeeded } from "@/lib/seed-agents";
import { resolveProviders } from "@/lib/ai/providers";
import { generateMarketingKit } from "@/lib/marketing/suite";
import { architectAutoDeployPlan } from "@/lib/ai/auto-deploy-blueprint";
import {
  ALO_SERVER_SPEC,
  allocateNextAvailablePort,
  assertTenantPortAllowed,
} from "@/lib/deploy/server-spec";

const OperatorRequestSchema = z.object({
  command: z
    .enum([
      "natural_language",
      "status_report",
      "activate_plan",
      "generate_invoice",
      "mark_invoice_paid",
      "auto_deploy_site",
      "create_crm_lead",
      "launch_marketing_campaign",
    ])
    .default("natural_language"),
  prompt: z.string().max(4000).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

async function resolveOperatorActor(
  request: NextRequest,
): Promise<{ user: AuthUser; authMode: "session" | "api_key" }> {
  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const rawToken = authHeader.slice(7).trim();
    if (rawToken && rawToken !== "session" && rawToken !== "null") {
      const keyHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const apiKeyRow = await db.apiKey.findUnique({
        where: { keyHash },
        include: {
          user: {
            include: {
              role: { include: { permissions: { include: { permission: true } } } },
            },
          },
        },
      });
      if (
        apiKeyRow &&
        apiKeyRow.user.isActive &&
        !apiKeyRow.user.isLocked &&
        (!apiKeyRow.expiresAt || apiKeyRow.expiresAt.getTime() > Date.now())
      ) {
        await db.apiKey
          .update({ where: { id: apiKeyRow.id }, data: { lastUsedAt: new Date() } })
          .catch(() => undefined);
        return {
          authMode: "api_key",
          user: {
            id: apiKeyRow.user.id,
            email: apiKeyRow.user.email,
            name: apiKeyRow.user.name,
            role: apiKeyRow.user.role.name,
            permissions: apiKeyRow.user.role.permissions.map((rp) => rp.permission.name),
          },
        };
      }
    }
  }

  const sessionUser = await requireSession(request);
  return { user: sessionUser, authMode: "session" };
}

function handleErr(e: unknown): NextResponse {
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      apiError("Validation failed", "VALIDATION_ERROR", e.flatten(), 400),
      { status: 400 },
    );
  }
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  if (e instanceof Error) {
    return NextResponse.json(apiError(e.message, "BAD_REQUEST", undefined, 400), { status: 400 });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

async function collectUsedPorts(): Promise<number[]> {
  const [serverPorts, websites] = await Promise.all([
    db.serverPort.findMany({ select: { port: true } }),
    db.website.findMany({ where: { deletedAt: null }, select: { applicationPort: true } }),
  ]);
  const used = new Set<number>(ALO_SERVER_SPEC.portAllocation.reservedPorts);
  for (const r of serverPorts) if (typeof r.port === "number") used.add(r.port);
  for (const w of websites) if (typeof w.applicationPort === "number") used.add(w.applicationPort);
  return Array.from(used);
}

function inferIntentFromPrompt(prompt: string): {
  inferredCommand:
    | "status_report"
    | "activate_plan"
    | "generate_invoice"
    | "auto_deploy_site"
    | "create_crm_lead"
    | "launch_marketing_campaign";
  extractedDomain?: string;
  extractedPlan?: string;
  extractedAmount?: number;
  extractedEmail?: string;
} {
  const lower = prompt.toLowerCase();
  const domainMatch = prompt.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
  const emailMatch = prompt.match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i);
  const amountMatch = prompt.match(/(?:\$|usd\s*|bdt\s*|৳\s*)(\d+(?:\.\d{1,2})?)/i);

  if (
    lower.includes("upgrade") ||
    lower.includes("activate") ||
    lower.includes("সাবস্ক্রিপশন চালু") ||
    lower.includes("প্ল্যান আপগ্রেড") ||
    lower.includes("প্ল্যান চালু")
  ) {
    const plan = lower.includes("enterprise")
      ? "enterprise"
      : lower.includes("business") || lower.includes("premium") || lower.includes("pro")
        ? "business"
        : "starter";
    return { inferredCommand: "activate_plan", extractedPlan: plan };
  }

  if (
    (lower.includes("invoice") && (lower.includes("create") || lower.includes("generate") || lower.includes("issue"))) ||
    lower.includes("ইনভয়েস তৈরি") ||
    lower.includes("ইনভয়েস তৈরি") ||
    lower.includes("বিল তৈরি")
  ) {
    return {
      inferredCommand: "generate_invoice",
      extractedAmount: amountMatch?.[1] ? Number(amountMatch[1]) : 49,
    };
  }

  if (
    (lower.includes("deploy") || lower.includes("ডিপ্লয়") || lower.includes("ডিপ্লয়") || lower.includes("সাইট চালু")) &&
    domainMatch?.[1] &&
    !emailMatch
  ) {
    return {
      inferredCommand: "auto_deploy_site",
      extractedDomain: domainMatch[1].toLowerCase(),
    };
  }

  if (
    (lower.includes("lead") || lower.includes("লিড") || lower.includes("crm")) &&
    emailMatch?.[1]
  ) {
    return {
      inferredCommand: "create_crm_lead",
      extractedEmail: emailMatch[1].toLowerCase(),
    };
  }

  if (
    lower.includes("marketing") ||
    lower.includes("campaign") ||
    lower.includes("মার্কেটিং") ||
    lower.includes("ক্যাম্পেইন")
  ) {
    return { inferredCommand: "launch_marketing_campaign" };
  }

  return { inferredCommand: "status_report" };
}

export async function GET(request: NextRequest) {
  try {
    const { user, authMode } = await resolveOperatorActor(request);
    const isAdmin = isAdminRole(user.role);
    const userFilter = isAdmin ? {} : { userId: user.id };
    const siteFilter = isAdmin ? { deletedAt: null } : { deletedAt: null, ownerId: user.id };

    await ensureDefaultAgentsSeeded();
    const billAgent = await db.aiAgent.findUnique({
      where: { slug: "alo-bill-ops-autopilot" },
    });

    const [
      activeSubscription,
      plans,
      invoices,
      ordersCount,
      websites,
      leadsCount,
      deals,
      campaignsCount,
      subscribersCount,
      ossConnectorsCount,
      usedPorts,
      recentRuns,
    ] = await Promise.all([
      db.subscription.findFirst({
        where: { status: "active", ...userFilter },
        orderBy: { createdAt: "desc" },
        include: { plan: true },
      }),
      db.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } }),
      db.invoice.findMany({ where: userFilter, orderBy: { createdAt: "desc" }, take: 15 }),
      db.order.count({ where: userFilter }),
      db.website.findMany({
        where: siteFilter,
        orderBy: { createdAt: "desc" },
        take: 15,
        select: { id: true, name: true, domain: true, runtime: true, status: true, applicationPort: true },
      }),
      db.crmContact.count({ where: userFilter }),
      db.crmDeal.findMany({ where: userFilter, select: { value: true } }),
      db.emailCampaign.count({ where: userFilter }),
      db.newsletter.count(),
      db.secret.count({ where: { type: "ai_open_source_provider" } }),
      collectUsedPorts(),
      billAgent
        ? db.aiAgentRun.findMany({
            where: { agentId: billAgent.id, ...(isAdmin ? {} : { userId: user.id }) },
            orderBy: { createdAt: "desc" },
            take: 12,
          })
        : Promise.resolve([]),
    ]);

    const nextAvailablePort = allocateNextAvailablePort(usedPorts);
    const paidRevenue = Number(
      (invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amountCents, 0) / 100).toFixed(2),
    );
    const pendingBilling = Number(
      (
        invoices
          .filter((i) => i.status === "pending" || i.status === "overdue")
          .reduce((s, i) => s + i.amountCents, 0) / 100
      ).toFixed(2),
    );
    const pipelineValue = deals.reduce((s, d) => s + (d.value || 0), 0);
    const aiResolution = resolveProviders(process.env);

    return NextResponse.json(
      apiSuccess({
        authMode,
        agent: {
          id: billAgent?.id ?? "alo-bill-ops-autopilot",
          slug: "alo-bill-ops-autopilot",
          name: "Bill Agent AI — বিল এজেন্ট এআই",
          status: "online",
          capabilities: [
            "status_report",
            "activate_plan",
            "generate_invoice",
            "mark_invoice_paid",
            "auto_deploy_site",
            "create_crm_lead",
            "launch_marketing_campaign",
          ],
        },
        billing: {
          activeSubscription: activeSubscription
            ? {
                id: activeSubscription.id,
                plan: activeSubscription.plan.slug ?? activeSubscription.plan.name,
                status: activeSubscription.status,
                amount: Number((activeSubscription.plan.priceCents / 100).toFixed(2)),
              }
            : null,
          plansCount: plans.length,
          plans: plans.map((p) => ({
            id: p.id,
            slug: p.slug ?? p.name.toLowerCase(),
            name: p.name,
            priceMonthly: Number((p.priceCents / 100).toFixed(2)),
            priceYearly: Number(((p.priceCents * 10) / 100).toFixed(2)),
          })),
          recentInvoices: invoices.map((inv) => ({
            id: inv.id,
            amount: Number((inv.amountCents / 100).toFixed(2)),
            currency: inv.currency,
            status: inv.status,
            createdAt: inv.createdAt,
          })),
          ordersCount,
          paidRevenue,
          pendingBilling,
        },
        hosting: {
          serverHostname: ALO_SERVER_SPEC.hostName,
          serverIp: ALO_SERVER_SPEC.publicIp,
          reservedControlPlanePort: ALO_SERVER_SPEC.controlPlane.port,
          nextAvailablePort,
          siteCount: websites.length,
          websites: websites.map((w) => ({
            id: w.id,
            name: w.name ?? w.domain,
            domain: w.domain,
            runtime: w.runtime,
            status: w.status,
            deployPort: w.applicationPort,
          })),
        },
        growth: {
          leadsCount,
          dealsCount: deals.length,
          pipelineValue,
          campaignsCount,
          subscribersCount,
        },
        aiProviders: {
          defaultOrder: aiResolution.order,
          openSourceConnectorsCount: ossConnectorsCount,
          openSourceExtensibility: ["ollama", "localai", "vllm", "litellm", "openwebui", "gateway"],
        },
        recentRuns,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const { user, authMode } = await resolveOperatorActor(request);
    const isAdmin = isAdminRole(user.role);
    const parsed = OperatorRequestSchema.parse(await request.json());

    await ensureDefaultAgentsSeeded();
    const billAgent = await db.aiAgent.findUnique({
      where: { slug: "alo-bill-ops-autopilot" },
    });

    let effectiveCommand = parsed.command;
    const params: Record<string, unknown> = { ...(parsed.params ?? {}) };

    if (effectiveCommand === "natural_language") {
      const inferred = inferIntentFromPrompt(parsed.prompt || "");
      effectiveCommand = inferred.inferredCommand;
      if (inferred.extractedPlan && !params.planSlug) params.planSlug = inferred.extractedPlan;
      if (inferred.extractedDomain && !params.domain) params.domain = inferred.extractedDomain;
      if (inferred.extractedAmount && !params.amount) params.amount = inferred.extractedAmount;
      if (inferred.extractedEmail && !params.email) params.email = inferred.extractedEmail;
    }

    let summaryBn = "";
    let summaryEn = "";
    let actionResult: Record<string, unknown> = {};

    if (effectiveCommand === "activate_plan") {
      const rawSlug = String(params.planSlug || params.planId || "business").toLowerCase();
      const targetSlug = rawSlug === "premium" ? "business" : rawSlug;
      const cycle = params.billingCycle === "yearly" ? "yearly" : "monthly";
      const plan =
        (await db.plan.findFirst({
          where: {
            isActive: true,
            OR: [{ slug: targetSlug }, { id: rawSlug }, { name: { contains: targetSlug } }],
          },
        })) ?? (await db.plan.findFirst({ where: { isActive: true }, orderBy: { priceCents: "asc" } }));

      if (!plan) {
        throw new Error("No active hosting plans configured");
      }

      const amountCents = cycle === "yearly" ? plan.priceCents * 10 : plan.priceCents;
      const amountUsd = Number((amountCents / 100).toFixed(2));
      const now = new Date();
      const periodEnd = new Date(now);
      if (cycle === "yearly") periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      else periodEnd.setMonth(periodEnd.getMonth() + 1);
      const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;

      const txResult = await db.$transaction(async (tx) => {
        await tx.subscription.updateMany({
          where: { userId: user.id, status: "active" },
          data: { status: "cancelled", cancelledAt: now },
        });
        const subscription = await tx.subscription.create({
          data: {
            userId: user.id,
            planId: plan.id,
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
          include: { plan: true },
        });
        const order = await tx.order.create({
          data: {
            orderNumber,
            userId: user.id,
            totalCents: amountCents,
            currency: "USD",
            status: "completed",
            paymentMethod: "bill_agent_ai",
            completedAt: now,
            items: {
              create: [
                {
                  type: "plan_upgrade",
                  description: `${plan.name} (${cycle})`,
                  quantity: 1,
                  unitPriceCents: amountCents,
                  totalCents: amountCents,
                },
              ],
            },
          },
        });
        const invoice = await tx.invoice.create({
          data: {
            userId: user.id,
            subscriptionId: subscription.id,
            amountCents,
            currency: "USD",
            status: "paid",
            dueDate: periodEnd,
            paidAt: now,
          },
        });
        return { subscription, order, invoice };
      });

      summaryBn = `বিল এজেন্ট এআই সফলভাবে "${plan.name}" প্ল্যান ($${amountUsd.toFixed(2)}) চালু করেছে এবং পেইড ইনভয়েস জেনারেট করেছে।`;
      summaryEn = `Bill Agent AI activated the "${plan.name}" plan ($${amountUsd.toFixed(2)}) and issued paid invoice #${txResult.invoice.id.slice(0, 8).toUpperCase()}.`;
      actionResult = txResult;
    } else if (effectiveCommand === "generate_invoice") {
      const amountUsd = Math.max(0.5, Number(params.amount ?? 49));
      const amountCents = Math.round(amountUsd * 100);
      const status = params.markPaid === true ? "paid" : "pending";
      const now = new Date();
      const due = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const invoice = await db.invoice.create({
        data: {
          userId: user.id,
          amountCents,
          currency: String(params.currency || "USD").toUpperCase(),
          status,
          dueDate: due,
          paidAt: status === "paid" ? now : null,
        },
      });
      summaryBn = `বিল এজেন্ট এআই $${amountUsd.toFixed(2)}-এর নতুন ইনভয়েস (#${invoice.id.slice(0, 8).toUpperCase()}) তৈরি করেছে।`;
      summaryEn = `Bill Agent AI generated invoice #${invoice.id.slice(0, 8).toUpperCase()} for $${amountUsd.toFixed(2)} (${status}).`;
      actionResult = { invoice };
    } else if (effectiveCommand === "mark_invoice_paid") {
      const invoiceId = String(params.invoiceId || "");
      const target = invoiceId
        ? await db.invoice.findUnique({ where: { id: invoiceId } })
        : await db.invoice.findFirst({
            where: { status: "pending", ...(isAdmin ? {} : { userId: user.id }) },
            orderBy: { createdAt: "desc" },
          });
      if (!target || (!isAdmin && target.userId !== user.id)) {
        return NextResponse.json(
          apiError("No matching open invoice found", "NOT_FOUND", undefined, 404),
          { status: 404 },
        );
      }
      const updated = await db.invoice.update({
        where: { id: target.id },
        data: { status: "paid", paidAt: new Date() },
      });
      const usd = (updated.amountCents / 100).toFixed(2);
      summaryBn = `ইনভয়েস #${updated.id.slice(0, 8).toUpperCase()} ($${usd}) পেইড হিসেবে আপডেট করা হয়েছে।`;
      summaryEn = `Invoice #${updated.id.slice(0, 8).toUpperCase()} ($${usd}) marked as paid.`;
      actionResult = { invoice: updated };
    } else if (effectiveCommand === "auto_deploy_site") {
      const rawDomain = String(params.domain || "")
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "");
      if (!rawDomain || !rawDomain.includes(".")) {
        throw new Error("Valid domain required for auto_deploy_site (e.g., shop.alolabs.net)");
      }
      if (rawDomain === ALO_SERVER_SPEC.controlPlane.domain) {
        throw new Error("hosting.alolabs.net (port 3051) is protected and cannot be overwritten");
      }

      const usedPorts = await collectUsedPorts();
      if (params.port !== undefined) {
        assertTenantPortAllowed(Number(params.port));
      }

      const plan = await architectAutoDeployPlan({
        prompt: String(parsed.prompt || params.description || `Deploy ${rawDomain} on alo-server-lap`),
        domain: rawDomain,
        appName: String(params.projectName || rawDomain.split(".")[0]),
        usedPorts,
      });

      const existing = await db.website.findUnique({ where: { domain: rawDomain } });
      if (existing) {
        throw new Error(`Domain "${rawDomain}" is already registered`);
      }

      const targetServer = await db.server.findFirst({
        where: { OR: [{ name: ALO_SERVER_SPEC.hostName }, { ipAddress: ALO_SERVER_SPEC.publicIp }] },
      });

      const provisioned = await db.$transaction(async (tx) => {
        const website = await tx.website.create({
          data: {
            name: plan.appName,
            domain: plan.domain,
            runtime: plan.websiteRuntime,
            status: "ACTIVE",
            documentRoot: `/srv/alo-sites/${plan.domain}`,
            applicationPort: plan.allocatedPort,
            startupCommand: plan.deployConfig.startCmd ?? null,
            buildCommand: plan.deployConfig.buildCmd ?? null,
            outputDirectory: plan.deployConfig.outputDir,
            healthPath: plan.deployConfig.healthPath,
            healthStatus: "HEALTHY",
            ownerId: user.id,
          },
        });
        await tx.domain.create({
          data: {
            domain: plan.domain,
            primary: true,
            sslEnabled: true,
            sslStatus: "PENDING",
            dnsVerified: false,
            nameservers: JSON.stringify(["ns1.alolabs.net", "ns2.alolabs.net"]),
            websiteId: website.id,
          },
        });
        const deployment = await tx.deployment.create({
          data: {
            websiteId: website.id,
            actorId: user.id,
            branch: "main",
            trigger: "BILL_AGENT_AI_OPERATOR",
            status: "SUCCESS",
            stage: "verify",
            buildOutput: `[Bill Agent AI] Allocated port ${plan.allocatedPort} on ${ALO_SERVER_SPEC.hostName} (${ALO_SERVER_SPEC.publicIp}).`,
          },
        });
        if (targetServer) {
          const portTaken = await tx.serverPort.findUnique({
            where: { serverId_port: { serverId: targetServer.id, port: plan.allocatedPort } },
          });
          if (!portTaken) {
            await tx.serverPort.create({
              data: {
                serverId: targetServer.id,
                port: plan.allocatedPort,
                service: plan.appName,
                websiteId: website.id,
              },
            });
          }
        }
        return { website, deployment };
      });

      summaryBn = `বিল এজেন্ট এআই "${plan.domain}" সাইটটি ${ALO_SERVER_SPEC.hostName}-এ পোর্ট ${plan.allocatedPort}-এ সফলভাবে প্রভিশন করেছে।`;
      summaryEn = `Bill Agent AI provisioned "${plan.domain}" on ${ALO_SERVER_SPEC.hostName} (port ${plan.allocatedPort}).`;
      actionResult = { ...provisioned, shareableYaml: plan.shareableBriefYaml };
    } else if (effectiveCommand === "create_crm_lead") {
      const email = String(params.email || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        throw new Error("A valid email address is required to create a CRM lead");
      }
      const firstName = String(params.firstName || email.split("@")[0] || "Lead").trim();
      const dealValue = params.dealValue !== undefined ? Number(params.dealValue) : 199;
      const created = await db.$transaction(async (tx) => {
        const contact = await tx.crmContact.create({
          data: {
            firstName,
            email,
            company: params.company ? String(params.company) : null,
            status: "lead",
            source: "bill_agent_ai",
            userId: user.id,
          },
        });
        const deal = await tx.crmDeal.create({
          data: {
            title: String(params.dealTitle || `${firstName} Hosting & Growth Deal`),
            value: dealValue,
            stage: "qualification",
            probability: 35,
            contactId: contact.id,
            userId: user.id,
          },
        });
        await tx.newsletter.upsert({
          where: { email },
          update: {},
          create: { email },
        });
        return { contact, deal };
      });
      summaryBn = `বিল এজেন্ট এআই নতুন লিড (${email}) এবং $${dealValue} ভ্যালুর CRM ডিল যোগ করেছে।`;
      summaryEn = `Bill Agent AI captured CRM lead ${email} and opened a $${dealValue} pipeline deal.`;
      actionResult = created;
    } else if (effectiveCommand === "launch_marketing_campaign") {
      const brandName = String(params.brandName || "ALO Labs");
      const offer = String(params.offer || parsed.prompt || "Managed Cloud Hosting & AI Automation");
      const kit = await generateMarketingKit({
        brandName,
        offerOrProduct: offer,
        targetAudience: String(params.targetAudience || "Digital businesses & agencies"),
      });
      const subCount = Math.max(1, await db.newsletter.count());
      const campaign = await db.emailCampaign.create({
        data: {
          name: String(params.campaignName || `${brandName} AI Growth Campaign`),
          subject: kit.emailBroadcast.subject,
          fromName: brandName,
          fromAddress: user.email,
          status: params.sendImmediately === true ? "sent" : "draft",
          content: kit.emailBroadcast.htmlContent,
          textContent: kit.emailBroadcast.textContent,
          recipientCount: subCount,
          sentCount: params.sendImmediately === true ? subCount : 0,
          sentAt: params.sendImmediately === true ? new Date() : null,
          userId: user.id,
        },
      });
      summaryBn = `বিল এজেন্ট এআই ৩৬০° মার্কেটিং কিট এবং "${campaign.name}" ইমেইল ক্যাম্পেইন তৈরি করেছে।`;
      summaryEn = `Bill Agent AI generated a 360° marketing kit and created campaign "${campaign.name}".`;
      actionResult = { campaign, kit };
    } else {
      // status_report
      const userFilter = isAdmin ? {} : { userId: user.id };
      const [sub, invCount, siteCount, leadCount, campCount, usedPorts] = await Promise.all([
        db.subscription.findFirst({
          where: { status: "active", ...userFilter },
          orderBy: { createdAt: "desc" },
          include: { plan: true },
        }),
        db.invoice.count({ where: userFilter }),
        db.website.count({ where: { deletedAt: null, ...(isAdmin ? {} : { ownerId: user.id }) } }),
        db.crmContact.count({ where: userFilter }),
        db.emailCampaign.count({ where: userFilter }),
        collectUsedPorts(),
      ]);
      const nextPort = allocateNextAvailablePort(usedPorts);
      const planName = sub ? (sub.plan.slug ?? sub.plan.name) : "none";
      summaryBn = `সিস্টেম স্ট্যাটাস: অ্যাক্টিভ প্ল্যান = ${planName}, ইনভয়েস = ${invCount}টি, ওয়েবসাইট = ${siteCount}টি (পরবর্তী ফ্রি পোর্ট: ${nextPort}), CRM লিড = ${leadCount}টি, মার্কেটিং ক্যাম্পেইন = ${campCount}টি।`;
      summaryEn = `System Status: Active Plan = ${planName}, Invoices = ${invCount}, Websites = ${siteCount} (next free port on alo-server-lap: ${nextPort}), CRM Leads = ${leadCount}, Marketing Campaigns = ${campCount}.`;
      actionResult = {
        activePlan: sub ? planName : null,
        invoiceCount: invCount,
        siteCount,
        nextAvailablePort: nextPort,
        leadCount,
        campaignCount: campCount,
      };
    }

    const durationMs = Date.now() - startedAt;

    if (billAgent) {
      await db.aiAgentRun.create({
        data: {
          agentId: billAgent.id,
          userId: user.id,
          input: JSON.stringify({ command: effectiveCommand, prompt: parsed.prompt ?? null }),
          output: `${summaryBn}\n${summaryEn}`,
          model: "alo-bill-ops-autopilot",
          tokensUsed: 0,
          durationMs,
          status: "completed",
        },
      });
    }

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: `BILL_AGENT_AI_${effectiveCommand.toUpperCase()}`,
      resourceType: "AiAgent",
      resourceId: billAgent?.id ?? "alo-bill-ops-autopilot",
      result: "SUCCESS",
      metadata: { authMode, command: effectiveCommand, durationMs },
    });

    return NextResponse.json(
      apiSuccess({
        executedCommand: effectiveCommand,
        authMode,
        summaryBn,
        summaryEn,
        durationMs,
        result: actionResult,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
