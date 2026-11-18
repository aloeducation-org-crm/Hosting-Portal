import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError } from "@/lib/response";
import { claimTask, expireStaleTasks, signTaskEnvelope } from "@/lib/agents/agent";
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
 *
 * SEC-07: the control plane has always *produced* this signature, but the agent
 * never checked it (`verify()` existed in agent/alo-agent.mjs and was never
 * called), so the claim in the paragraph above was not true. Worse, the signed
 * body was a four-field projection of the task while `executeTask` read the
 * full stored row, so even a checked signature would not have bound the fields
 * that actually ran. The envelope is now built by `signTaskEnvelope`, is signed
 * over a canonically ordered object, and carries the complete task the agent is
 * allowed to execute. The agent refuses any task whose payload does not match
 * its signature, or whose payload carries fields it did not expect.
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
  const envelope = signTaskEnvelope(secret, task, timestamp, nonce);

  return NextResponse.json(
    apiSuccess(
      {
        // The signed payload IS the task the agent executes. There is no second,
        // unsigned copy for it to read from, which is what makes the signature
        // meaningful.
        task: envelope.task,
        signature: envelope.signature,
        timestamp: envelope.timestamp,
        nonce: envelope.nonce,
      },
      "Task claimed",
    ),
  );
}
