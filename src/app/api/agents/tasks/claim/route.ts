import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError } from "@/lib/response";
import { claimTask, expireStaleTasks } from "@/lib/agents/agent";
import { signPayload } from "@/lib/agents/agent";
import { decryptSecret } from "@/lib/encryption";
import { requireAgent, parseBody } from "@/lib/agents/http";
import { randomBytes } from "node:crypto";

/**
 * Agent task polling.
 *
 * Returns at most one task per call, claimed atomically. Each task carries a
 * `signature` the agent verifies with its own secret before executing, so a
 * task can only come from a control plane that already holds that secret — and
 * an agent still refuses anything outside its compiled-in allowlist.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.ok) {
    return NextResponse.json(apiError(auth.message, auth.code, undefined, auth.status), { status: auth.status });
  }
  parseBody(auth.body); // body is signed but unused for this call

  await expireStaleTasks().catch(() => 0);
  const task = await claimTask(auth.agent.id);
  if (!task) return NextResponse.json(apiSuccess({ task: null }, "No task pending"));

  let secret: string;
  try {
    secret = decryptSecret(auth.agent.secretEnc);
  } catch {
    return NextResponse.json(apiError("Agent secret could not be decrypted; rotate it", "AGENT_SECRET_INVALID", undefined, 500), { status: 500 });
  }

  const timestamp = String(Date.now());
  const nonce = randomBytes(12).toString("hex");
  const body = JSON.stringify({ taskId: task.id, command: task.command, args: task.args, timeoutMs: task.timeoutMs });
  const signature = signPayload(secret, body, timestamp, nonce);

  return NextResponse.json(
    apiSuccess({
      task: {
        id: task.id,
        command: task.command,
        args: task.args,
        timeoutMs: task.timeoutMs,
        correlationId: task.correlationId,
        jobId: task.jobId,
      },
      signature,
      timestamp,
      nonce,
      signedBody: body,
    }, "Task claimed"),
  );
}
