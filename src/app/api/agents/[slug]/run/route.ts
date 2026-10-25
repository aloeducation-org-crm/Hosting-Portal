import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { apiError, type ApiResponse } from '@/lib/response';
import { AIProviderError, completeWithAI } from '@/lib/ai/client';
import { recordAIUsage } from '@/lib/ai/usage';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * POST /api/agents/:slug/run — { input, config? }
 *
 * Runs the agent against the configured provider chain. There is deliberately no
 * built-in "demo response" fallback: if no provider is reachable the caller gets
 * a 503/502 with the real reason, so nobody mistakes generated boilerplate for
 * model output.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const user = await requireSession(request);
    const { slug } = await params;

    const agent = await db.aiAgent.findUnique({ where: { slug } });
    if (!agent || !agent.isActive) {
      return NextResponse.json({ success: false, error: 'Agent not found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      input?: unknown;
      config?: Record<string, string>;
    };
    const input = typeof body.input === 'string' ? body.input.trim() : '';
    if (!input) {
      return NextResponse.json({ success: false, error: 'Input is required' }, { status: 400 });
    }
    if (input.length > 20_000) {
      return NextResponse.json({ success: false, error: 'Input is too large (max 20k characters)' }, { status: 413 });
    }

    const agentConfig = (agent.config as Record<string, unknown> | null) ?? {};
    const systemPrompt =
      (typeof agentConfig.systemPrompt === 'string' && agentConfig.systemPrompt) ||
      `You are ${agent.name}. ${agent.description ?? ''} Answer with concrete, production-usable output.`.trim();

    let userPrompt = input;
    const userConfig = body.config ?? {};
    if (userConfig.language && userConfig.language !== 'Auto-detect') {
      userPrompt = `[Programming Language: ${userConfig.language}]\n\n${userPrompt}`;
    }
    if (userConfig.targetLanguage) {
      userPrompt = `[Translate to: ${userConfig.targetLanguage}]\n\n${userPrompt}`;
    }

    const startedAt = Date.now();
    const completion = await completeWithAI(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: typeof agentConfig.temperature === 'number' ? agentConfig.temperature : undefined,
        maxTokens: typeof agentConfig.maxTokens === 'number' ? agentConfig.maxTokens : undefined,
        model: typeof agentConfig.model === 'string' ? agentConfig.model : undefined,
        signal: request.signal,
      },
    );
    const durationMs = Date.now() - startedAt;

    const run = await db.aiAgentRun.create({
      data: {
        agentId: agent.id,
        userId: user.id,
        input,
        output: completion.text,
        model: completion.model,
        tokensUsed: completion.tokensUsed,
        durationMs,
        status: 'completed',
      },
      select: { id: true },
    });

    await db.aiAgent.update({ where: { id: agent.id }, data: { updatedAt: new Date() } });
    await recordAIUsage({
      userId: user.id,
      model: completion.model,
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
      totalTokens: completion.tokensUsed,
      requestId: run.id,
    });

    return NextResponse.json({
      success: true,
      output: completion.text,
      runId: run.id,
      model: completion.model,
      provider: completion.provider,
      tokensUsed: completion.tokensUsed,
      durationMs,
    });
  } catch (e) {
    if (e instanceof AIProviderError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code, attempts: e.attempts },
        { status: e.status },
      );
    }
    return handleErr(e);
  }
}
