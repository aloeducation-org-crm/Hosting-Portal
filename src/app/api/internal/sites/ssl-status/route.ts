import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  domainName: z.string().trim().toLowerCase().max(253).regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/),
  sslStatus: z.enum(["ACTIVE", "EXPIRED", "PENDING"]),
}).strict();

function authorized(request: NextRequest): boolean {
  const expected = process.env.SSL_STATUS_HOOK_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const payload = payloadSchema.parse(await request.json());
    const site = await db.site.update({
      where: { domainName: payload.domainName },
      data: { sslStatus: payload.sslStatus },
      select: { id: true, domainName: true, sslStatus: true, updatedAt: true },
    });
    logger.info({ event: "site.ssl_status.updated", siteId: site.id, domainName: site.domainName, sslStatus: site.sslStatus }, "Site SSL status updated");
    return NextResponse.json({ success: true, site });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: "Invalid payload" }, { status: 400 });
    logger.error({ event: "site.ssl_status.update_failed", error }, "Failed to update site SSL status");
    return NextResponse.json({ success: false, error: "Site status update failed" }, { status: 500 });
  }
}
