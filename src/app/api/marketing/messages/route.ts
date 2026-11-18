import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";
import { listPilotMessaging, queuePilotSms, recordPilotConsent, suppressPilotRecipient } from "@/lib/messaging/control";
import { smsText } from "@/lib/messaging/config";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("record_consent"), channel: z.enum(["EMAIL", "SMS"]), address: z.string().max(254), consentRef: z.string().trim().min(3).max(160), optedIn: z.literal(true) }).strict(),
  z.object({ action: z.literal("suppress"), recipientId: z.uuid() }).strict(),
  z.object({ action: z.literal("queue_sms"), recipientId: z.uuid(), requestId: z.uuid(), text: smsText }).strict(),
]);
function failure(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const response = error as ApiResponse;
    return NextResponse.json(response, { status: response.status });
  }
  return NextResponse.json(apiError("Messaging is temporarily unavailable"), { status: 500 });
}
export async function GET(request: NextRequest) {
  try {
    const actor = await requireSession(request);
    return NextResponse.json(apiSuccess(await listPilotMessaging(actor)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await requireSession(request);
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw apiError("Invalid pilot messaging request", "VALIDATION_ERROR", undefined, 400);
    const data = parsed.data;
    if (data.action === "record_consent") {
      return NextResponse.json(apiSuccess(await recordPilotConsent(actor, data), "Opt-in recorded"));
    }
    if (data.action === "suppress") {
      await suppressPilotRecipient(actor, data.recipientId);
      return NextResponse.json(apiSuccess({}, "Suppression recorded"));
    }
    const reply = await queuePilotSms(actor, data);
    return NextResponse.json(apiSuccess(reply, reply.duplicate ? "Existing SMS request" : "SMS queued; not yet accepted", reply.duplicate ? 200 : 202), { status: reply.duplicate ? 200 : 202 });
  } catch (error) { return failure(error); }
}
