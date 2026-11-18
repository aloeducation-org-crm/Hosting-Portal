import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession, isAdminRole } from "@/lib/auth";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";
import { createAuditLog } from "@/lib/audit";
import { campaignDeliveryCounts, canQueuePilotMessages, ownerCanSend, queuePilotCampaign } from "@/lib/messaging/control";
import {
  buildUtmTrackingUrl,
  generateMarketingKit,
  generateSeoPackage,
} from "@/lib/marketing/suite";

const MarketingActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate_campaign_kit"),
    brandName: z.string().min(1).max(120),
    offerOrProduct: z.string().min(2).max(500),
    targetAudience: z.string().min(2).max(300),
    landingUrl: z.string().max(500).optional(),
    language: z.enum(["bn", "en"]).optional(),
    tone: z.enum(["professional", "bold", "friendly"]).optional(),
  }),
  z.object({
    action: z.literal("seo_audit"),
    domain: z.string().min(3).max(253),
    pageTitle: z.string().min(3).max(160),
    metaDescription: z.string().min(10).max(400),
    primaryKeyword: z.string().min(2).max(100),
    secondaryKeywords: z.array(z.string().max(80)).max(15).optional(),
    schemaType: z.enum(["Organization", "SoftwareApplication", "Product", "LocalBusiness"]).optional(),
  }),
  z.object({
    action: z.literal("build_utm"),
    baseUrl: z.string().min(4).max(500),
    source: z.string().min(1).max(80),
    medium: z.string().min(1).max(80),
    campaign: z.string().min(1).max(120),
    content: z.string().max(120).optional(),
    term: z.string().max(120).optional(),
    saveLink: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("create_campaign"),
    name: z.string().min(2).max(160),
    subject: z.string().min(2).max(200),
    fromName: z.string().max(120).optional(),
    fromAddress: z.string().email().optional(),
    content: z.string().max(100_000).optional(),
    textContent: z.string().max(50_000).optional(),
    sendImmediately: z.boolean().default(false),
    scheduledAt: z.string().optional(),
  }),
  z.object({
    action: z.literal("dispatch_campaign"),
    campaignId: z.string().min(1),
  }),
  z.object({
    action: z.literal("capture_lead"),
    firstName: z.string().min(1).max(100),
    lastName: z.string().max(100).optional(),
    email: z.string().email(),
    phone: z.string().max(40).optional(),
    company: z.string().max(120).optional(),
    source: z.string().max(80).default("digital-marketing"),
    dealTitle: z.string().max(160).optional(),
    dealValue: z.number().min(0).max(100_000_000).optional(),
  }),
  z.object({
    action: z.literal("add_subscriber"),
    email: z.string().email(),
    optedIn: z.literal(true),
  }),
  z.object({
    action: z.literal("remove_subscriber"),
    id: z.string().min(1),
  }),
]);

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
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const isAdmin = isAdminRole(user.role);
    const userScope = isAdmin ? {} : { userId: user.id };

    const [
      campaigns,
      subscribers,
      leads,
      deals,
      websites,
      savedUtmLinks,
    ] = await Promise.all([
      db.emailCampaign.findMany({
        where: userScope,
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      isAdmin ? db.newsletter.findMany({ orderBy: { createdAt: "desc" }, take: 100 }) : [],
      db.crmContact.findMany({
        where: userScope,
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.crmDeal.findMany({
        where: userScope,
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.website.findMany({
        where: { deletedAt: null, ...(isAdmin ? {} : { ownerId: user.id }) },
        select: { id: true, name: true, domain: true, status: true },
        take: 50,
      }),
      db.promptTemplate.findMany({
        where: { category: "marketing_utm", ...userScope },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    const deliveryCounts = await campaignDeliveryCounts(campaigns.map(({ id }) => id));
    const totalAccepted = [...deliveryCounts.values()].reduce((sum, value) => sum + value.accepted, 0);
    const pipelineValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);

    return NextResponse.json(
      apiSuccess({
        metrics: {
          campaignCount: campaigns.length,
          subscriberCount: subscribers.length,
          leadCount: leads.length,
          dealCount: deals.length,
          pipelineValue,
          totalAccepted,
        },
        canQueuePilot: canQueuePilotMessages(user) && await ownerCanSend(db, user.id),
        canManageLegacyNewsletter: isAdmin,
        campaigns: campaigns.map(({ sentCount: _sent, sentAt: _time, ...campaign }) => ({
          ...campaign, delivery: deliveryCounts.get(campaign.id) ?? null,
        })),
        subscribers,
        leads,
        deals,
        websites,
        savedUtmLinks,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const isAdmin = isAdminRole(user.role);
    const parsed = MarketingActionSchema.parse(await request.json());

    if (parsed.action === "generate_campaign_kit") {
      const kit = await generateMarketingKit(parsed);
      return NextResponse.json(apiSuccess({ kit }));
    }

    if (parsed.action === "seo_audit") {
      const seo = generateSeoPackage(parsed);
      return NextResponse.json(apiSuccess({ seo }));
    }

    if (parsed.action === "build_utm") {
      const trackingUrl = buildUtmTrackingUrl(parsed);
      let savedRecord = null;
      if (parsed.saveLink) {
        savedRecord = await db.promptTemplate.create({
          data: {
            name: `${parsed.campaign} (${parsed.source}/${parsed.medium})`,
            category: "marketing_utm",
            content: trackingUrl,
            variables: JSON.stringify({
              source: parsed.source,
              medium: parsed.medium,
              campaign: parsed.campaign,
              content: parsed.content ?? null,
              term: parsed.term ?? null,
            }),
            userId: user.id,
          },
        });
      }
      return NextResponse.json(apiSuccess({ trackingUrl, savedRecord }));
    }

    if (parsed.action === "create_campaign") {
      if (parsed.sendImmediately || parsed.scheduledAt) {
        throw apiError("Save a draft, then confirm queueing. Scheduled sends are not enabled.", "EXPLICIT_DISPATCH_REQUIRED", undefined, 409);
      }
      const campaign = await db.emailCampaign.create({
        data: {
          name: parsed.name.trim(),
          subject: parsed.subject.trim(),
          fromName: parsed.fromName?.trim() || "ALO Digital Growth",
          fromAddress: parsed.fromAddress?.trim() || user.email,
          status: "draft",
          content: parsed.content ?? null,
          textContent: parsed.textContent ?? null,
          userId: user.id,
        },
      });

      await createAuditLog({
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: "MARKETING_CAMPAIGN_CREATED",
        resourceType: "EmailCampaign",
        resourceId: campaign.id,
        result: "SUCCESS",
        metadata: { status: "draft" },
      });

      return NextResponse.json(apiSuccess({ campaign }, "Marketing campaign saved"), { status: 201 });
    }

    if (parsed.action === "dispatch_campaign") {
      const result = await queuePilotCampaign(user, parsed.campaignId);
      const status = result.duplicate ? 200 : 202;
      return NextResponse.json(apiSuccess(result,
        result.duplicate ? "Campaign already queued or processed" : "Campaign queued; delivery not yet confirmed", status), { status });
    }

    if (parsed.action === "capture_lead") {
      const emailNorm = parsed.email.trim().toLowerCase();
      const created = await db.$transaction(async (tx) => {
        const contact = await tx.crmContact.create({
          data: {
            firstName: parsed.firstName.trim(),
            lastName: parsed.lastName?.trim() || null,
            email: emailNorm,
            phone: parsed.phone?.trim() || null,
            company: parsed.company?.trim() || null,
            status: "lead",
            source: parsed.source.trim(),
            tags: JSON.stringify(["marketing", parsed.source.trim()]),
            userId: user.id,
          },
        });

        const deal =
          parsed.dealTitle && parsed.dealTitle.trim().length > 0
            ? await tx.crmDeal.create({
                data: {
                  title: parsed.dealTitle.trim(),
                  value: parsed.dealValue ?? 0,
                  stage: "qualification",
                  probability: 30,
                  contactId: contact.id,
                  userId: user.id,
                  notes: `Captured via Digital Marketing Hub (${parsed.source})`,
                },
              })
            : null;

        // CRM participation is not email consent, including for older clients
        // still sending the discarded subscribeNewsletter property.
        return { contact, deal };
      });

      return NextResponse.json(
        apiSuccess(created, "Lead captured and synced to CRM pipeline"),
        { status: 201 },
      );
    }

    if (parsed.action === "add_subscriber") {
      if (!isAdmin) throw apiError("Administrator required for the legacy newsletter list", "FORBIDDEN", undefined, 403);
      const emailNorm = parsed.email.trim().toLowerCase();
      const subscriber = await db.newsletter.upsert({
        where: { email: emailNorm },
        update: {},
        create: { email: emailNorm },
      });
      return NextResponse.json(apiSuccess({ subscriber }, "Legacy newsletter entry recorded (not a pilot recipient)"), { status: 201 });
    }

    // remove_subscriber
    if (!isAdmin) {
      return NextResponse.json(
        apiError("Admin permission required to delete global newsletter entries", "FORBIDDEN", undefined, 403),
        { status: 403 },
      );
    }
    await db.newsletter.delete({ where: { id: parsed.id } });
    return NextResponse.json(apiSuccess({ deleted: true }, "Subscriber removed"));
  } catch (e) {
    return handleErr(e);
  }
}
