/**
 * Token accounting for AI calls.
 *
 * Every completion returns real `usage` from the upstream when it reports one.
 * We persist that against the acting user so `/api/ai/token-usage` and the
 * dashboard reflect actual consumption. `costUsd` stays 0 unless the operator
 * knows their per-token price: the panel does not invent invoices for provider
 * usage it cannot verify (see docs/AI-AUTOMATION.md).
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export interface UsageInput {
  userId?: string | null;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  requestId?: string | null;
}

/** Best-effort: never fail an AI response because usage logging failed. */
export async function recordAIUsage(input: UsageInput): Promise<void> {
  if (!input.userId) return;
  const promptTokens = Math.max(Math.trunc(input.promptTokens ?? 0), 0);
  const completionTokens = Math.max(Math.trunc(input.completionTokens ?? 0), 0);
  const totalTokens = Math.max(Math.trunc(input.totalTokens ?? promptTokens + completionTokens), 0);
  try {
    await db.tokenUsage.create({
      data: {
        userId: input.userId,
        model: input.model ?? null,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: 0,
        requestId: input.requestId ?? null,
      },
    });
  } catch (error) {
    logger.warn({ err: error, userId: input.userId }, "Failed to record AI token usage");
  }
}
