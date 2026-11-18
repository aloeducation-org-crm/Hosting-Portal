import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { apiError } from "@/lib/response";
import { canViewCompany } from "@/lib/app-center";

export const createConversationSchema = z
  .object({
    organizationId: z.string().min(1),
    type: z.enum(["DIRECT", "GROUP"]),
    name: z.string().trim().max(80).optional(),
    participantIds: z.array(z.string().min(1)).min(1).max(49),
  })
  .superRefine((value, ctx) => {
    if (value.type === "GROUP" && !value.name?.trim()) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "Group name is required" });
    }
  });

export const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().trim().min(1, "Message cannot be empty").max(4_000),
});

export type ChatActor = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
};

type CommunicationsDb = Pick<
  PrismaClient,
  "organization" | "membership" | "user" | "chatParticipant"
>;

export async function requireOrganizationAccess(
  client: CommunicationsDb,
  actor: ChatActor,
  organizationId: string,
): Promise<void> {
  if (!(await canViewCompany(client as PrismaClient, actor, organizationId))) {
    throw apiError("You do not have access to that company", "FORBIDDEN", undefined, 403);
  }
}

/**
 * Users who may be invited into a company room. The organization owner is
 * included even when an older tenant row has no matching Membership record.
 */
export async function listOrganizationChatMembers(
  client: CommunicationsDb,
  actor: ChatActor,
  organizationId: string,
) {
  await requireOrganizationAccess(client, actor, organizationId);

  const organization = await client.organization.findUnique({
    where: { id: organizationId },
    select: {
      ownerId: true,
      memberships: { select: { userId: true, role: true } },
    },
  });
  if (!organization) {
    throw apiError("Company not found", "NOT_FOUND", undefined, 404);
  }

  const membershipRoles = new Map(
    organization.memberships.map((membership) => [membership.userId, membership.role]),
  );
  const userIds = new Set([organization.ownerId, ...membershipRoles.keys()]);
  // Platform admins can start a room in a company they administer without
  // silently making themselves an organization member.
  userIds.add(actor.id);

  const users = await client.user.findMany({
    where: { id: { in: [...userIds] }, isActive: true, isLocked: false },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });

  return users.map((user) => ({
    ...user,
    organizationRole:
      user.id === organization.ownerId ? "OWNER" : (membershipRoles.get(user.id) ?? "PLATFORM_ADMIN"),
  }));
}

export async function requireConversationParticipant(
  client: CommunicationsDb,
  actorId: string,
  conversationId: string,
) {
  const participant = await client.chatParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: actorId } },
    include: { conversation: true },
  });
  if (!participant) {
    // Do not reveal whether a private conversation exists.
    throw apiError("Conversation not found", "NOT_FOUND", undefined, 404);
  }
  return participant;
}

export function directConversationKey(organizationId: string, userIds: string[]): string {
  return `${organizationId}:${[...new Set(userIds)].sort().join(":")}`;
}

export function conversationDisplayName(
  conversation: {
    type: string;
    name: string | null;
    participants: Array<{ userId: string; user: { name: string | null; email: string } }>;
  },
  viewerId: string,
): string {
  if (conversation.type === "GROUP") return conversation.name?.trim() || "Unnamed group";
  const others = conversation.participants.filter((participant) => participant.userId !== viewerId);
  if (!others.length) return "Direct message";
  return others.map((participant) => participant.user.name?.trim() || participant.user.email).join(", ");
}

export function validationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}
