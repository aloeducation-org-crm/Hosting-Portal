import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { requireConversationParticipant } from "@/lib/communications";
import { db } from "@/lib/db";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";

const readSchema = z.object({ messageId: z.string().min(1) });

function handleError(error: unknown): NextResponse {
  if (error && typeof error === "object" && "status" in error) {
    const response = error as ApiResponse;
    return NextResponse.json(response, { status: response.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/** PATCH /api/communications/conversations/[id]/read */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireSession(request);
    const { id: conversationId } = await context.params;
    const participant = await requireConversationParticipant(db, actor.id, conversationId);
    const parsed = readSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        apiError("messageId is required", "VALIDATION_ERROR", undefined, 400),
        { status: 400 },
      );
    }

    const message = await db.chatMessage.findFirst({
      where: { id: parsed.data.messageId, conversationId },
      select: { id: true, createdAt: true },
    });
    if (!message) {
      return NextResponse.json(apiError("Message not found", "NOT_FOUND", undefined, 404), {
        status: 404,
      });
    }

    if (participant.lastReadAt && participant.lastReadAt >= message.createdAt) {
      return NextResponse.json(apiSuccess({ lastReadAt: participant.lastReadAt, changed: false }));
    }

    const unreadCount = await db.chatMessage.count({
      where: {
        conversationId,
        createdAt: {
          gt: participant.lastReadAt ?? participant.joinedAt,
          lte: message.createdAt,
        },
        OR: [{ senderId: null }, { senderId: { not: actor.id } }],
      },
    });
    await db.chatParticipant.update({
      where: { conversationId_userId: { conversationId, userId: actor.id } },
      data: { lastReadAt: message.createdAt },
    });

    await createAuditLog({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "CHAT_CONVERSATION_READ",
      resourceType: "chat_conversation",
      resourceId: conversationId,
      domain: "communications",
      result: "success",
      metadata: { readThroughMessageId: message.id, unreadCount },
    });

    return NextResponse.json(apiSuccess({ lastReadAt: message.createdAt, changed: true }));
  } catch (error) {
    return handleError(error);
  }
}
