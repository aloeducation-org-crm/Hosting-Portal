import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { requireConversationParticipant, sendMessageSchema, validationIssues } from "@/lib/communications";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";

function handleError(error: unknown): NextResponse {
  if (error && typeof error === "object" && "status" in error) {
    const response = error as ApiResponse;
    return NextResponse.json(response, { status: response.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

const senderSelect = { id: true, name: true, email: true, image: true } as const;

/** GET /api/communications/messages?conversationId=...&q=...&cursor=... */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireSession(request);
    const params = new URL(request.url).searchParams;
    const conversationId = params.get("conversationId")?.trim();
    if (!conversationId) {
      return NextResponse.json(
        apiError("conversationId is required", "VALIDATION_ERROR", undefined, 400),
        { status: 400 },
      );
    }
    await requireConversationParticipant(db, actor.id, conversationId);

    const query = (params.get("q") ?? "").trim().slice(0, 100);
    const cursor = params.get("cursor")?.trim() || null;
    const requestedLimit = Number.parseInt(params.get("limit") ?? "50", 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;

    if (cursor) {
      const cursorMessage = await db.chatMessage.findFirst({
        where: { id: cursor, conversationId },
        select: { id: true },
      });
      if (!cursorMessage) {
        return NextResponse.json(
          apiError("Message cursor is invalid", "VALIDATION_ERROR", undefined, 400),
          { status: 400 },
        );
      }
    }

    const rows = await db.chatMessage.findMany({
      where: {
        conversationId,
        ...(query ? { body: { contains: query } } : {}),
      },
      include: { sender: { select: senderSelect } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;
    const messages = page.reverse();

    return NextResponse.json(
      apiSuccess({ messages, nextCursor, hasMore, query: query || null }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return handleError(error);
  }
}

/** POST /api/communications/messages */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireSession(request);
    const limited = checkRateLimit(`chat-message:${actor.id}`, {
      windowMs: 60_000,
      maxRequests: 60,
    });
    if (!limited.allowed) {
      return NextResponse.json(
        apiError("Message rate limit exceeded", "RATE_LIMITED", undefined, 429),
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))) },
        },
      );
    }

    const raw = await request.json().catch(() => null);
    const parsed = sendMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Invalid message", "VALIDATION_ERROR", { issues: validationIssues(parsed.error) }, 400),
        { status: 400 },
      );
    }

    const { conversationId, body } = parsed.data;
    await requireConversationParticipant(db, actor.id, conversationId);
    const now = new Date();
    const message = await db.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: { conversationId, senderId: actor.id, body, kind: "TEXT" },
        include: { sender: { select: senderSelect } },
      });
      await tx.chatConversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.createdAt },
      });
      await tx.chatParticipant.update({
        where: { conversationId_userId: { conversationId, userId: actor.id } },
        data: { lastReadAt: now },
      });
      return created;
    });

    await createAuditLog({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "CHAT_MESSAGE_SEND",
      resourceType: "chat_message",
      resourceId: message.id,
      domain: "communications",
      result: "success",
      metadata: { conversationId, characterCount: body.length },
    });

    return NextResponse.json(apiSuccess({ message }, "Message sent", 201), {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleError(error);
  }
}
