import type { NextRequest } from "next/server";
import { authenticateAgentRequest } from "@/lib/agents/agent";
import type { ServerAgent } from "@prisma/client";

export interface AgentAuthOk {
  ok: true;
  agent: ServerAgent;
  body: string;
}
export interface AgentAuthFail {
  ok: false;
  status: number;
  code: string;
  message: string;
}

function clientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || undefined;
}

/**
 * Authenticate an agent request: the raw body is read once and hashed into the
 * HMAC, so the signature covers exactly the bytes that were sent.
 */
export async function requireAgent(request: NextRequest): Promise<AgentAuthOk | AgentAuthFail> {
  const agentKey = request.headers.get("x-alo-agent-key");
  const signature = request.headers.get("x-alo-signature");
  const timestamp = request.headers.get("x-alo-timestamp");
  const nonce = request.headers.get("x-alo-nonce");

  if (!agentKey || !signature || !timestamp || !nonce) {
    return { ok: false, status: 401, code: "MISSING_AGENT_AUTH", message: "x-alo-agent-key, x-alo-signature, x-alo-timestamp and x-alo-nonce are required" };
  }

  const body = await request.text();
  const result = await authenticateAgentRequest({ agentKey, signature, timestamp, nonce, body, ip: clientIp(request) });
  if (!result.ok) {
    return { ok: false, status: 401, code: "AGENT_AUTH_FAILED", message: result.reason };
  }
  return { ok: true, agent: result.agent, body };
}

export function parseBody(body: string): unknown {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export { clientIp };
