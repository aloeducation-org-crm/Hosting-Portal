import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { AIProviderError, completeWithAI, type AIMessage } from '@/lib/ai/client';
import { recordAIUsage } from '@/lib/ai/usage';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 12_000;
const AGENT_PROMPTS = {
  alolabs:
    'You are ALOlabs, the official AI assistant for ALO Labs (hosting.alolabs.net). Help users with web hosting, domains, websites, and zero-terminal application deployment in a clear, friendly way. You do not have access to live account or server state and cannot perform actions; never claim that you changed settings or deployed anything — instead guide users to click "Deploy Project Visually" in /ai/assistant when ready.',
  'deploy-assistant':
    'You are ALOlabs Zero-Terminal Deploy Assistant for hosting.alolabs.net. Help users launch Next.js, Node.js, Python (FastAPI/Django/Flask), PHP 8.2, and Static sites visually without using a terminal: choosing 1-click stack presets, organizing company workspaces, attaching domains + free Auto-SSL, enabling zero-code PostgreSQL/MariaDB blueprints, configuring scheduled backups, and setting health-check auto-rollback. Never output raw root shell commands unless explicitly asked; explain the visual controls in /ai/assistant and remind the user that actual provisioning only happens when they click Deploy.',
  'code-assistant':
    'You are ALOlabs Code Assistant. Help users understand, write, and debug application code. Be practical and security-conscious. You cannot access their repository or deploy code unless an authorized tool explicitly says so.',
  'website-builder':
    'You are ALOlabs Website Builder Assistant. Help users plan, write, and improve websites, including layout, accessibility, SEO, and content. Do not claim that you published or changed a website.',
  'domain-advisor':
    'You are ALOlabs Domain Advisor. Help users choose domains and understand DNS and SSL concepts. You cannot check live availability or modify DNS unless a tool explicitly provides that capability.',
} satisfies Record<string, string>;

/** POST /api/ai/chat — { message } or { messages: [...] } */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await request.json().catch(() => ({}));
    const rawHistory = body.messages;
    const requestedAgent =
      typeof body.agentType === 'string' && Object.hasOwn(AGENT_PROMPTS, body.agentType)
        ? (body.agentType as keyof typeof AGENT_PROMPTS)
        : 'alolabs';
    const systemPrompt = AGENT_PROMPTS[requestedAgent];

    let messages: AIMessage[] = [];
    if (Array.isArray(rawHistory) && rawHistory.length) {
      const history = rawHistory
        .filter((entry): entry is { role: 'user' | 'assistant'; content: string } =>
          Boolean(entry) && typeof entry === 'object' &&
          typeof (entry as { content?: unknown }).content === 'string' &&
          ['user', 'assistant'].includes(String((entry as { role?: unknown }).role)))
        .slice(-MAX_MESSAGES)
        .map((entry) => ({
          role: entry.role,
          content: entry.content.slice(0, MAX_MESSAGE_CHARS),
        }));
      messages = [{ role: 'system', content: systemPrompt }, ...history];
    } else {
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) {
        return NextResponse.json(apiError('Message is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
      }
      messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message.slice(0, MAX_MESSAGE_CHARS) },
      ];
    }

    const result = await completeWithAI(messages, { signal: request.signal });
    await recordAIUsage({
      userId: user.id,
      model: result.model,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.tokensUsed,
    });

    return NextResponse.json(apiSuccess({
      reply: result.text,
      model: result.model,
      provider: result.provider,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
    }));
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
