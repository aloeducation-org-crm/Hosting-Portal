/**
 * Must stay first: all chat route writes go to a throwaway database copy.
 */
import { teardownIsolatedDb } from "./helpers/isolated-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { APP_CATEGORIES, BUILTIN_APPS } from "@/lib/app-center";
import { directConversationKey } from "@/lib/communications";
import { isProtectedDashboardPath } from "@/proxy";
import { GET as getMembers } from "@/app/api/communications/members/route";
import {
  GET as getConversations,
  POST as createConversation,
} from "@/app/api/communications/conversations/route";
import {
  GET as getMessages,
  POST as sendMessage,
} from "@/app/api/communications/messages/route";
import { PATCH as markConversationRead } from "@/app/api/communications/conversations/[id]/read/route";

const JWT_SECRET = process.env.NEXTAUTH_SECRET || "t".repeat(64);
const MIGRATION_NAME = "20261111120000_self_hosted_team_chat";
const MIGRATION_FILE = path.resolve("prisma/migrations", MIGRATION_NAME, "migration.sql");

type TestUser = { id: string; email: string; role: string };

async function request(
  url: string,
  user?: TestUser,
  init?: { method?: string; body?: unknown },
): Promise<NextRequest> {
  const headers = new Headers();
  if (user) {
    const token = await encode({
      secret: JWT_SECRET,
      token: { id: user.id, sub: user.id, email: user.email, role: user.role },
    });
    headers.set("cookie", `next-auth.session-token=${token}`);
  }
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function body(response: Response) {
  return response.json();
}

let admin: TestUser;
let client: TestUser;
let reseller: TestUser;
let organizationA = "";
let organizationB = "";

beforeAll(async () => {
  const rows = await db.user.findMany({
    where: { email: { in: ["admin@alolabs.net", "client@alolabs.net", "reseller@alolabs.net"] } },
    select: { id: true, email: true, role: { select: { name: true } } },
  });
  const find = (email: string): TestUser => {
    const row = rows.find((candidate) => candidate.email === email);
    if (!row) throw new Error(`Seeded test user missing: ${email}`);
    return { id: row.id, email: row.email, role: row.role.name };
  };
  admin = find("admin@alolabs.net");
  client = find("client@alolabs.net");
  reseller = find("reseller@alolabs.net");

  const suffix = Date.now().toString(36);
  organizationA = (
    await db.organization.create({
      data: {
        name: "Chat Tenant A",
        slug: `chat-tenant-a-${suffix}`,
        ownerId: client.id,
        memberships: {
          create: [
            { userId: client.id, role: "OWNER", acceptedAt: new Date() },
            { userId: reseller.id, role: "MEMBER", acceptedAt: new Date() },
          ],
        },
      },
      select: { id: true },
    })
  ).id;
  organizationB = (
    await db.organization.create({
      data: {
        name: "Chat Tenant B",
        slug: `chat-tenant-b-${suffix}`,
        ownerId: admin.id,
        memberships: { create: { userId: admin.id, role: "OWNER", acceptedAt: new Date() } },
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await teardownIsolatedDb();
});

describe("team-chat migration contract", () => {
  it("is registered, additive-only and represented in the tracked database", async () => {
    const sql = fs.readFileSync(MIGRATION_FILE, "utf8");
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(statements).toHaveLength(11);
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS /i);
      expect(statement).not.toMatch(/^\s*(DROP\s|DELETE\s|TRUNCATE|ALTER\s|UPDATE\s|INSERT\s)/im);
    }
    for (const line of sql.split("\n")) {
      if (line.trim().startsWith("--")) expect(line).not.toContain(";");
    }
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "chat_conversations"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "chat_participants"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "chat_messages"');

    const applier = fs.readFileSync(path.resolve("scripts/apply-deploy-schema.mjs"), "utf8");
    expect(applier).toContain(`{ name: "${MIGRATION_NAME}", kind: "ADDITIVE" }`);

    const rows = await db.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('chat_conversations', 'chat_participants', 'chat_messages')
      ORDER BY name
    `;
    expect(rows.map((row) => row.name)).toEqual([
      "chat_conversations",
      "chat_messages",
      "chat_participants",
    ]);
  });

  it("builds deterministic direct-conversation keys", () => {
    expect(directConversationKey("org-1", ["user-b", "user-a", "user-b"]))
      .toBe("org-1:user-a:user-b");
  });

  it("registers the protected dashboard and App Center surfaces", () => {
    expect(isProtectedDashboardPath("/dashboard/communications")).toBe(true);
    const page = fs.readFileSync(path.resolve("src/app/dashboard/communications/page.tsx"), "utf8");
    const shell = fs.readFileSync(path.resolve("src/components/dashboard/DashboardShell.tsx"), "utf8");
    expect(page).toContain("CommunicationsCenter");
    expect(shell).toContain('label: "Team Chat", href: "/dashboard/communications"');
    expect(APP_CATEGORIES).toContainEqual({ id: "communication", label: "Communication" });
    expect(BUILTIN_APPS.find((app) => app.slug === "team-chat")).toMatchObject({
      route: "/dashboard/communications",
      category: "communication",
    });
  });
});

describe("team-chat API", () => {
  let directId = "";
  let firstMessageId = "";

  it("requires authentication", async () => {
    const response = await getConversations(
      await request(`http://localhost/api/communications/conversations?organizationId=${organizationA}`),
    );
    expect(response.status).toBe(401);
  });

  it("lists only company members and blocks a foreign tenant", async () => {
    const allowed = await getMembers(
      await request(
        `http://localhost/api/communications/members?organizationId=${organizationA}`,
        client,
      ),
    );
    expect(allowed.status).toBe(200);
    const allowedBody = await body(allowed);
    expect(allowedBody.data.members.map((member: { id: string }) => member.id)).toEqual(
      expect.arrayContaining([client.id, reseller.id]),
    );

    const forbidden = await getMembers(
      await request(
        `http://localhost/api/communications/members?organizationId=${organizationB}`,
        client,
      ),
    );
    expect(forbidden.status).toBe(403);
  });

  it("rejects non-members, creates one direct room and reuses it", async () => {
    const invalid = await createConversation(
      await request("http://localhost/api/communications/conversations", client, {
        method: "POST",
        body: {
          organizationId: organizationA,
          type: "DIRECT",
          participantIds: [admin.id],
        },
      }),
    );
    expect(invalid.status).toBe(400);

    const created = await createConversation(
      await request("http://localhost/api/communications/conversations", client, {
        method: "POST",
        body: {
          organizationId: organizationA,
          type: "DIRECT",
          participantIds: [reseller.id],
        },
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = await body(created);
    directId = createdBody.data.conversation.id;
    expect(createdBody.data.existing).toBe(false);

    const duplicate = await createConversation(
      await request("http://localhost/api/communications/conversations", client, {
        method: "POST",
        body: {
          organizationId: organizationA,
          type: "DIRECT",
          participantIds: [reseller.id],
        },
      }),
    );
    expect(duplicate.status).toBe(200);
    const duplicateBody = await body(duplicate);
    expect(duplicateBody.data).toMatchObject({ existing: true, conversation: { id: directId } });
    expect(await db.chatConversation.count({ where: { organizationId: organizationA, type: "DIRECT" } })).toBe(1);
  });

  it("creates named groups and validates their shape", async () => {
    const unnamed = await createConversation(
      await request("http://localhost/api/communications/conversations", client, {
        method: "POST",
        body: { organizationId: organizationA, type: "GROUP", participantIds: [reseller.id] },
      }),
    );
    expect(unnamed.status).toBe(400);

    const group = await createConversation(
      await request("http://localhost/api/communications/conversations", client, {
        method: "POST",
        body: {
          organizationId: organizationA,
          type: "GROUP",
          name: "Operations",
          participantIds: [reseller.id],
        },
      }),
    );
    expect(group.status).toBe(201);
  });

  it("sends, reads and searches messages only as a participant", async () => {
    const sent = await sendMessage(
      await request("http://localhost/api/communications/messages", client, {
        method: "POST",
        body: { conversationId: directId, body: "Launch checklist is ready" },
      }),
    );
    expect(sent.status).toBe(201);
    const sentBody = await body(sent);
    firstMessageId = sentBody.data.message.id;
    expect(sentBody.data.message.body).toBe("Launch checklist is ready");

    const outsider = await getMessages(
      await request(
        `http://localhost/api/communications/messages?conversationId=${directId}`,
        admin,
      ),
    );
    expect(outsider.status).toBe(404);

    const searched = await getMessages(
      await request(
        `http://localhost/api/communications/messages?conversationId=${directId}&q=checklist`,
        reseller,
      ),
    );
    expect(searched.status).toBe(200);
    const searchedBody = await body(searched);
    expect(searchedBody.data.messages).toHaveLength(1);
    expect(searchedBody.data.messages[0].id).toBe(firstMessageId);

    const resellerRooms = await getConversations(
      await request(
        `http://localhost/api/communications/conversations?organizationId=${organizationA}`,
        reseller,
      ),
    );
    const resellerRoomsBody = await body(resellerRooms);
    const direct = resellerRoomsBody.data.conversations.find(
      (conversation: { id: string }) => conversation.id === directId,
    );
    expect(direct).toMatchObject({ unreadCount: 1, type: "DIRECT" });
    expect(direct.participants).toHaveLength(2);

    const read = await markConversationRead(
      await request(
        `http://localhost/api/communications/conversations/${directId}/read`,
        reseller,
        { method: "PATCH", body: { messageId: firstMessageId } },
      ),
      { params: Promise.resolve({ id: directId }) },
    );
    expect(read.status).toBe(200);

    const afterRead = await getConversations(
      await request(
        `http://localhost/api/communications/conversations?organizationId=${organizationA}`,
        reseller,
      ),
    );
    const afterReadBody = await body(afterRead);
    expect(
      afterReadBody.data.conversations.find(
        (conversation: { id: string }) => conversation.id === directId,
      ).unreadCount,
    ).toBe(0);
  });

  it("paginates older messages with a conversation-bound cursor", async () => {
    const base = Date.now() + 1_000;
    await db.chatMessage.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        id: randomUUID(),
        conversationId: directId,
        senderId: client.id,
        body: `Pagination message ${index + 1}`,
        createdAt: new Date(base + index * 1_000),
        updatedAt: new Date(base + index * 1_000),
      })),
    });

    const first = await getMessages(
      await request(
        `http://localhost/api/communications/messages?conversationId=${directId}&limit=5`,
        client,
      ),
    );
    const firstBody = await body(first);
    expect(firstBody.data.messages).toHaveLength(5);
    expect(firstBody.data.hasMore).toBe(true);
    expect(firstBody.data.nextCursor).toBeTruthy();

    const second = await getMessages(
      await request(
        `http://localhost/api/communications/messages?conversationId=${directId}&limit=5&cursor=${firstBody.data.nextCursor}`,
        client,
      ),
    );
    const secondBody = await body(second);
    expect(secondBody.data.messages).toHaveLength(5);
    const firstIds = new Set(firstBody.data.messages.map((message: { id: string }) => message.id));
    expect(secondBody.data.messages.every((message: { id: string }) => !firstIds.has(message.id))).toBe(true);
  });

  it("does not expose private tenant conversations to platform admins by default", async () => {
    const response = await getConversations(
      await request(
        `http://localhost/api/communications/conversations?organizationId=${organizationA}`,
        admin,
      ),
    );
    expect(response.status).toBe(200);
    const responseBody = await body(response);
    expect(responseBody.data.conversations).toEqual([]);
  });

  it("records audited chat writes without storing message bodies in audit metadata", async () => {
    const actions = await db.auditLog.findMany({
      where: { domain: "communications" },
      select: { action: true, metadata: true },
    });
    expect(actions.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "CHAT_CONVERSATION_CREATE",
        "CHAT_MESSAGE_SEND",
        "CHAT_CONVERSATION_READ",
      ]),
    );
    expect(JSON.stringify(actions.map((entry) => entry.metadata))).not.toContain("Launch checklist is ready");
  });
});
