import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { apiError, apiSuccess, type ApiResponse } from "@/lib/response";
import {
  conversationDisplayName,
  createConversationSchema,
  directConversationKey,
  listOrganizationChatMembers,
  requireOrganizationAccess,
  validationIssues,
} from "@/lib/communications";

function handleError(error: unknown): NextResponse {
  if (error && typeof error === "object" && "status" in error) {
    const response = error as ApiResponse;
    return NextResponse.json(response, { status: response.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

const participantUser = {
  select: { id: true, name: true, email: true, image: true },
} as const;

/** GET /api/communications/conversations?organizationId=... */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireSession(request);
    const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim();
    if (!organizationId) {
      return NextResponse.json(
        apiError("organizationId is required", "VALIDATION_ERROR", undefined, 400),
        { status: 400 },
      );
    }
    await requireOrganizationAccess(db, actor, organizationId);

    const memberships = await db.chatParticipant.findMany({
      where: { userId: actor.id, conversation: { organizationId } },
      include: {
        conversation: {
          include: {
            participants: {
              include: { user: participantUser },
              orderBy: { joinedAt: "asc" },
            },
            messages: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              include: { sender: participantUser },
            },
          },
        },
      },
      orderBy: { conversation: { updatedAt: "desc" } },
      take: 100,
    });

    const conversations = await Promise.all(
      memberships.map(async (membership) => {
        const conversation = membership.conversation;
        const unreadSince = membership.lastReadAt ?? membership.joinedAt;
        const unreadCount = await db.chatMessage.count({
          where: {
            conversationId: conversation.id,
            createdAt: { gt: unreadSince },
            OR: [{ senderId: null }, { senderId: { not: actor.id } }],
          },
        });
        const lastMessage = conversation.messages[0] ?? null;
        return {
          id: conversation.id,
          organizationId: conversation.organizationId,
          type: conversation.type,
          name: conversation.name,
          displayName: conversationDisplayName(conversation, actor.id),
          role: membership.role,
          muted: membership.muted,
          unreadCount,
          lastMessageAt: conversation.lastMessageAt,
          updatedAt: conversation.updatedAt,
          participants: conversation.participants.map((participant) => ({
            id: participant.id,
            userId: participant.userId,
            role: participant.role,
            user: participant.user,
          })),
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                body: lastMessage.body.slice(0, 160),
                createdAt: lastMessage.createdAt,
                sender: lastMessage.sender,
              }
            : null,
        };
      }),
    );

    return NextResponse.json(apiSuccess({ conversations }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleError(error);
  }
}

/** POST /api/communications/conversations */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireSession(request);
    const raw = await request.json().catch(() => null);
    const parsed = createConversationSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        apiError(
          "Invalid conversation",
          "VALIDATION_ERROR",
          { issues: validationIssues(parsed.error) },
          400,
        ),
        { status: 400 },
      );
    }

    const input = parsed.data;
    const availableMembers = await listOrganizationChatMembers(db, actor, input.organizationId);
    const allowedIds = new Set(availableMembers.map((member) => member.id));
    const invitedIds = [...new Set(input.participantIds)].filter((id) => id !== actor.id);

    if (invitedIds.some((id) => !allowedIds.has(id))) {
      return NextResponse.json(
        apiError(
          "Every participant must be an active member of this company",
          "VALIDATION_ERROR",
          undefined,
          400,
        ),
        { status: 400 },
      );
    }
    if (input.type === "DIRECT" && invitedIds.length !== 1) {
      return NextResponse.json(
        apiError("A direct conversation requires exactly one other participant", "VALIDATION_ERROR", undefined, 400),
        { status: 400 },
      );
    }
    if (input.type === "GROUP" && invitedIds.length < 1) {
      return NextResponse.json(
        apiError("A group requires at least one other participant", "VALIDATION_ERROR", undefined, 400),
        { status: 400 },
      );
    }

    const allParticipantIds = [actor.id, ...invitedIds];
    const directKey =
      input.type === "DIRECT" ? directConversationKey(input.organizationId, allParticipantIds) : null;
    if (directKey) {
      const existing = await db.chatConversation.findUnique({
        where: { directKey },
        select: { id: true, type: true, organizationId: true },
      });
      if (existing) {
        return NextResponse.json(apiSuccess({ conversation: existing, existing: true }));
      }
    }

    let conversation;
    try {
      conversation = await db.chatConversation.create({
        data: {
          organizationId: input.organizationId,
          type: input.type,
          name: input.type === "GROUP" ? input.name!.trim() : null,
          directKey,
          createdById: actor.id,
          participants: {
            create: allParticipantIds.map((userId) => ({
              userId,
              role: userId === actor.id ? "OWNER" : "MEMBER",
              lastReadAt: new Date(),
            })),
          },
        },
        select: { id: true, type: true, name: true, organizationId: true, createdAt: true },
      });
    } catch (error) {
      // A concurrent direct-message create may win the unique directKey race.
      if (directKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await db.chatConversation.findUnique({
          where: { directKey },
          select: { id: true, type: true, organizationId: true },
        });
        if (existing) return NextResponse.json(apiSuccess({ conversation: existing, existing: true }));
      }
      throw error;
    }

    await createAuditLog({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "CHAT_CONVERSATION_CREATE",
      resourceType: "chat_conversation",
      resourceId: conversation.id,
      domain: "communications",
      result: "success",
      metadata: {
        organizationId: input.organizationId,
        type: input.type,
        participantCount: allParticipantIds.length,
      },
    });

    return NextResponse.json(apiSuccess({ conversation, existing: false }, "Conversation created", 201), {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return handleError(error);
  }
}
