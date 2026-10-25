import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * Escape a string for safe insertion into an HTML context.
 * Replaces &, <, >, " with their corresponding HTML entities.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Call an OpenAI-compatible LLM API. Returns the generated text.
 * Requires OPENAI_API_KEY to be set in the environment.
 */
async function callLLM(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = (process.env.AI_MODEL as string) || 'gpt-4o-mini';

  if (!apiKey) {
    return '';
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * System prompt that instructs the LLM to generate a complete, standalone HTML page.
 */
const WEBSITE_SYSTEM_PROMPT = `You are an expert web designer. Generate a complete, standalone HTML page based on the user's description.
Return ONLY valid HTML (starting with <!DOCTYPE html>). Do not include markdown code fences.
Use modern CSS, responsive design, and professional styling. The output must be a self-contained HTML file with embedded styles.`;

/**
 * Default fallback HTML template used when no AI API key is configured.
 */
function buildDefaultHtml(safeDescription: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeDescription}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 1rem; }
    p { color: #666; line-height: 1.6; }
  </style>
</head>
<body>
  <h1>${safeDescription}</h1>
  <p>This is a demo website generated for: ${safeDescription}. Connect a real AI model for production-quality output.</p>
</body>
</html>`;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);

    const body = await request.json();
    const description = (body.description as string) ?? 'a modern website';

    // Escape the user-provided description for safe HTML insertion
    const safeDescription = escapeHtml(description);

    // Try calling the real LLM if OPENAI_API_KEY is configured
    const aiHtml = await callLLM(WEBSITE_SYSTEM_PROMPT, description);

    let html: string;
    if (aiHtml && aiHtml.trim()) {
      // LLM returned content — use it directly (LLM output is trusted server-side)
      html = aiHtml.trim();
    } else {
      // No AI key configured — use safe fallback template with escaped description
      html = buildDefaultHtml(safeDescription);
    }

    return NextResponse.json(apiSuccess({ html }));
  } catch (e) {
    return handleErr(e);
  }
}
