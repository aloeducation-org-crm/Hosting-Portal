import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiError, type ApiResponse } from '@/lib/response';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * Execute an AI agent by calling the configured LLM provider.
 * Supports OpenAI-compatible APIs (OpenAI, Groq, Together, Ollama, etc.)
 * via OPENAI_API_KEY + OPENAI_BASE_URL environment variables.
 *
 * Falls back to a built-in intelligent response generator when no API key
 * is configured, so the feature works out-of-the-box for demos.
 */
async function callLLM(
  systemPrompt: string,
  userMessage: string,
  config: Record<string, unknown>,
): Promise<{ text: string; model: string; tokensUsed: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = (process.env.AI_MODEL as string) || (config.model as string) || 'gpt-4o-mini';
  const temperature = (config.temperature as number) ?? 0.5;
  const maxTokens = (config.maxTokens as number) ?? 4096;

  // ── Real LLM call ──────────────────────────────────────────────────
  if (apiKey) {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
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
    const durationMs = Date.now() - start;

    return {
      text: data.choices?.[0]?.message?.content ?? '',
      model: data.model ?? model,
      tokensUsed: data.usage?.total_tokens ?? 0,
    };
  }

  // ── Built-in intelligent fallback (no API key) ─────────────────────
  // This provides useful, contextual responses for every agent type
  // so the platform is fully functional without external AI services.
  const start = Date.now();
  const response = generateBuiltInResponse(systemPrompt, userMessage);
  const durationMs = Date.now() - start;

  return {
    text: response,
    model: 'alolabs-built-in',
    tokensUsed: 0,
  };
}

/**
 * Built-in response generator that creates contextual, helpful responses
 * for each agent type without requiring an external AI API.
 */
function generateBuiltInResponse(systemPrompt: string, input: string): string {
  const prompt = systemPrompt.toLowerCase();
  const lines = input.split('\n').filter((l) => l.trim());

  // Detect agent type from system prompt
  if (prompt.includes('software engineer') || prompt.includes('code')) {
    return generateCodeResponse(input);
  }
  if (prompt.includes('web designer') || prompt.includes('website') || prompt.includes('html')) {
    return generateWebsiteResponse(input);
  }
  if (prompt.includes('domain name') || prompt.includes('branding') || prompt.includes('seo-friendly')) {
    return generateDomainResponse(input);
  }
  if (prompt.includes('seo') && !prompt.includes('domain')) {
    return generateSeoResponse(input);
  }
  if (prompt.includes('content writer') || prompt.includes('blog')) {
    return generateContentResponse(input);
  }
  if (prompt.includes('email') || prompt.includes('business communication')) {
    return generateEmailResponse(input);
  }
  if (prompt.includes('social media')) {
    return generateSocialMediaResponse(input);
  }
  if (prompt.includes('logo') || prompt.includes('brand identity')) {
    return generateLogoResponse(input);
  }
  if (prompt.includes('chatbot') || prompt.includes('conversation')) {
    return generateChatbotResponse(input);
  }
  if (prompt.includes('analytics') || prompt.includes('data analyst')) {
    return generateAnalyticsResponse(input);
  }
  if (prompt.includes('security') || prompt.includes('vulnerab')) {
    return generateSecurityResponse(input);
  }
  if (prompt.includes('backup') || prompt.includes('disaster recovery')) {
    return generateBackupResponse(input);
  }
  if (prompt.includes('migration') || prompt.includes('hosting provider')) {
    return generateMigrationResponse(input);
  }
  if (prompt.includes('performance') || prompt.includes('optimization')) {
    return generatePerformanceResponse(input);
  }
  if (prompt.includes('translator') || prompt.includes('translate')) {
    return generateTranslationResponse(input);
  }

  // Generic fallback
  return `Thank you for your request. Here is my analysis of your input:\n\n${input}\n\nThis is a built-in demo response. To get full AI-powered results, configure your OPENAI_API_KEY and OPENAI_BASE_URL environment variables to connect to any OpenAI-compatible API provider (OpenAI, Groq, Together AI, Ollama, etc.).\n\nYour request has been processed and logged. The AI Agent system is fully operational — once an API key is configured, this agent will produce rich, detailed AI-generated responses tailored to your specific needs.`;
}

function generateCodeResponse(input: string): string {
  return `// Generated by ALO Labs Code Agent\n// Request: ${input.slice(0, 100)}\n\n` +
    '```typescript\n' +
    '/**\n * Example implementation based on your request.\n * Connect an AI API (OpenAI/Groq/Ollama) for full code generation.\n */\n' +
    'interface ApiResponse<T> {\n' +
    '  success: boolean;\n' +
    '  data?: T;\n' +
    '  error?: string;\n' +
    '}\n\n' +
    'async function handleRequest<T>(input: T): Promise<ApiResponse<T>> {\n' +
    '  try {\n' +
    '    // Process your input here\n' +
    '    const result = input;\n' +
    '    return { success: true, data: result };\n' +
    '  } catch (error) {\n' +
    '    return { success: false, error: String(error) };\n' +
    '  }\n' +
    '}\n' +
    '```\n\n' +
    'This is a demo response. Set `OPENAI_API_KEY` in your `.env` file to enable full AI-powered code generation with proper context-aware implementations, error handling, and best practices.';
}

function generateWebsiteResponse(input: string): string {
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Generated Website</title>\n  <style>\n    * { margin: 0; padding: 0; box-sizing: border-box; }\n    body { font-family: -apple-system, sans-serif; background: #0f172a; color: #fff; }\n    .hero { min-height: 100vh; display: flex; align-items: center; justify-content: center; }\n    .container { max-width: 800px; padding: 2rem; text-align: center; }\n    h1 { font-size: 3rem; margin-bottom: 1rem; background: linear-gradient(135deg, #E8501A, #0A5CFF); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }\n    p { font-size: 1.25rem; color: #94a3b8; margin-bottom: 2rem; }\n    .btn { display: inline-block; padding: 0.75rem 2rem; background: #E8501A; color: #fff; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; text-decoration: none; transition: background 0.3s; }\n    .btn:hover { background: #C73D12; }\n  </style>\n</head>\n<body>\n  <div class="hero">\n    <div class="container">\n      <h1>Your Website</h1>\n      <p>Generated based on: ${input.slice(0, 80)}</p>\n      <a href="#" class="btn">Get Started</a>\n    </div>\n  </div>\n</body>\n</html>\n\nThis is a demo template. Connect an AI API for fully customized, multi-section responsive websites.`;
}

function generateDomainResponse(input: string): string {
  return `Domain Name Suggestions for: "${input.slice(0, 60)}"\n\n` +
    '1. **' + input.split(' ')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') + 'hub.com** — Brandable & memorable\n' +
    '2. **get' + input.split(' ')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') + '.io** — Tech-focused & modern\n' +
    '3. **' + input.split(' ')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') + 'ify.com** — Action-oriented\n' +
    '4. **my' + input.split(' ')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') + '.app** — Personal touch\n' +
    '5. **the' + input.split(' ')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') + '.co** — Professional & clean\n\n' +
    'Tips: Keep it under 12 characters, avoid hyphens, and check trademark databases.\n\nThis is a demo response. Connect an AI API for 10-15 personalized, SEO-optimized domain suggestions with availability analysis.';
}

function generateSeoResponse(input: string): string {
  return `SEO Analysis Report\n==================\n\nContent Analyzed: "${input.slice(0, 80)}..."\n\n` +
    'Overall SEO Score: 72/100\n\n' +
    'Findings:\n' +
    '- Title Tag: Add a compelling title under 60 characters\n' +
    '- Meta Description: Missing — add a 150-160 char description\n' +
    '- Heading Structure: Ensure H1 > H2 > H3 hierarchy\n' +
    '- Keyword Density: Aim for 1-2% primary keyword density\n' +
    '- Readability: Keep sentences under 20 words average\n' +
    '- Internal Links: Add 3-5 relevant internal links\n\n' +
    'This is a demo analysis. Connect an AI API for detailed, content-specific SEO reports with actionable recommendations.';
}

function generateContentResponse(input: string): string {
  return `# Generated Content\n\n${input.slice(0, 80)}\n\n` +
    'In today\'s fast-paced digital landscape, staying ahead of the competition requires a strategic approach to content creation. Whether you\'re building a brand, launching a product, or growing your audience, the right content can make all the difference.\n\n' +
    '## Why This Matters\n\n' +
    'Quality content drives engagement, builds trust, and converts visitors into loyal customers. Studies show that businesses with consistent content marketing see 6x higher conversion rates than those without.\n\n' +
    '## Key Takeaways\n\n' +
    '- Focus on providing genuine value to your audience\n' +
    '- Maintain a consistent publishing schedule\n' +
    '- Optimize for both readers and search engines\n' +
    '- Use data to refine your content strategy over time\n\n' +
    'This is demo content. Connect an AI API for fully customized, SEO-optimized content tailored to your specific niche and audience.';
}

function generateEmailResponse(input: string): string {
  return `Subject: Re: ${input.slice(0, 50)}\n\n` +
    'Dear [Recipient],\n\n' +
    'Thank you for reaching out regarding the matter above. I\'ve reviewed the details and would like to share my thoughts.\n\n' +
    'After careful consideration, I believe we can move forward with the proposed approach. I\'d suggest we schedule a brief call this week to align on the next steps and address any remaining questions.\n\n' +
    'Please let me know your availability, and I\'ll send over a calendar invite.\n\n' +
    'Best regards,\n[Your Name]\n\n' +
    'This is a demo email. Connect an AI API for context-aware, tone-matched professional emails for any business situation.';
}

function generateSocialMediaResponse(input: string): string {
  return `Social Media Content Plan\n========================\n\nTopic: ${input.slice(0, 60)}\n\n` +
    '**Twitter/X Post:**\nExcited to share what we\'ve been working on! ${input.slice(0, 50)} \ud83d\ude80\n#innovation #tech #startup\n\n' +
    '**LinkedIn Post:**\nBig news! We\'re launching something special. ${input.slice(0, 80)}\n\nHere\'s what makes it different:\n\n1. Built for scale\n2. Designed for simplicity\n3. Optimized for results\n\nWho\'s ready to transform their workflow? \u2b07\ufe0f\n\n#professional #business #growth\n\n' +
    '**Instagram Caption:**\nThe future is here. ${input.slice(0, 40)} \u2728\n\nDouble-tap if you agree! \ud83d\udc4d\n\n' +
    'This is demo content. Connect an AI API for platform-optimized, hashtag-researched social media content with engagement strategies.';
}

function generateLogoResponse(input: string): string {
  return `Logo Concepts for: "${input.slice(0, 60)}"\n\n` +
    '**Concept 1: Minimal Wordmark**\nClean, modern typography using a geometric sans-serif. The brand name in bold weight with letter-spacing adjustment. Color: Primary brand color with a subtle gradient. Works beautifully at any size.\n\n' +
    '**Concept 2: Icon + Wordmark**\nA geometric icon (abstract shape representing the brand\'s core value) placed to the left of the wordmark. The icon uses negative space cleverly. Colors: Two-tone using brand primary + accent.\n\n' +
    '**Concept 3: Emblem/Badge**\nA circular or shield-shaped emblem containing a stylized initial or symbol. Classic feel with modern execution. Works well for merchandise and app icons.\n\n' +
    'This is a demo response. Connect an AI API for detailed logo concepts with specific color palettes, typography pairings, and implementation guides.';
}

function generateChatbotResponse(input: string): string {
  return `Chatbot Conversation Flow\n==========================\n\nTrigger: ${input.slice(0, 60)}\n\n` +
    '**Greeting:**\nBot: "Hi there! Welcome to our platform. How can I help you today?"\n\n' +
    '**Main Menu:**\nBot: "I can help you with:\n1. Account & Billing\n2. Technical Support\n3. Product Information\n4. Talk to a Human\n\nJust type the number or tell me what you need!"\n\n' +
    '**FAQ Handling:**\nUser: "How do I reset my password?"\nBot: "No problem! Go to Settings > Security > Reset Password, or I can send you a reset link to your email. Which would you prefer?"\n\n' +
    '**Fallback:**\nBot: "I\'m not sure I understand. Let me connect you with a team member who can help. One moment please!"\n\n' +
    'This is a demo flow. Connect an AI API for complete, multi-branch conversation trees with personality configuration and escalation rules.';
}

function generateAnalyticsResponse(input: string): string {
  return `Analytics Interpretation Report\n==============================\n\nData Input: ${input.slice(0, 80)}\n\n` +
    '**Key Insights:**\n' +
    '1. Traffic Pattern: Based on the data provided, there appears to be a growth trend that should be monitored for sustainability.\n' +
    '2. User Engagement: Session duration and page views per session indicate moderate engagement. Consider A/B testing CTAs.\n' +
    '3. Conversion Funnel: The largest drop-off appears between the product page and checkout. Investigate friction points.\n\n' +
    '**Recommendations:**\n' +
    '- Implement exit-intent popups on high-drop-off pages\n' +
    '- Add social proof near conversion points\n' +
    '- Optimize page load speed (target < 3s)\n' +
    '- Set up heatmap tracking for behavioral insights\n\n' +
    'This is a demo analysis. Connect an AI API for data-driven insights with specific metrics, trends, and actionable recommendations.';
}

function generateSecurityResponse(input: string): string {
  return `Security Analysis Report\n========================\n\nCode/Config Analyzed: "${input.slice(0, 80)}..."\n\n` +
    '**Findings:**\n\n' +
    '| # | Severity | Issue | Status |\n' +
    '|---|----------|-------|--------|\n' +
    '| 1 | Medium | Input sanitization recommended | Review needed |\n' +
    '| 2 | Low | Consider adding rate limiting | Suggested |\n' +
    '| 3 | Medium | Add CSRF protection to forms | Review needed |\n\n' +
    '**Recommendations:**\n' +
    '- Validate and sanitize all user inputs on the server side\n' +
    '- Use parameterized queries for database operations\n' +
    '- Implement Content Security Policy headers\n' +
    '- Enable HTTPS everywhere and set secure cookie flags\n\n' +
    'This is a demo scan. Connect an AI API for detailed line-by-line security analysis with severity ratings and code fixes.';
}

function generateBackupResponse(input: string): string {
  return `Backup Strategy & Scripts\n==========================\n\nFor: ${input.slice(0, 60)}\n\n` +
    '**Recommended Strategy:**\n' +
    '- Frequency: Daily at 2 AM UTC + Weekly full backup on Sundays\n' +
    '- Retention: 30 daily, 12 weekly, 6 monthly backups\n' +
    '- Encryption: AES-256 at rest\n' +
    '- Storage: Local + Remote (S3-compatible)\n\n' +
    '**Sample Backup Script:**\n' +
    '```bash\n#!/bin/bash\nDATE=$(date +%Y%m%d_%H%M%S)\nBACKUP_DIR="/backups/$DATE"\nmkdir -p $BACKUP_DIR\n\n# Database backup\nsqlite3 /data/app.db ".backup $BACKUP_DIR/db.sqlite3"\n\n# Files backup\ntar czf $BACKUP_DIR/files.tar.gz /var/www/\n\necho "Backup completed: $BACKUP_DIR"\n```\n\n' +
    '**Disaster Recovery:**\n' +
    '1. Verify backup integrity weekly\n' +
    '2. Test restore procedure monthly\n' +
    '3. Document step-by-step recovery runbook\n' +
    '4. Set up monitoring alerts for backup failures\n\n' +
    'This is a demo strategy. Connect an AI API for tech-stack-specific backup scripts and complete DR plans.';
}

function generateMigrationResponse(input: string): string {
  return `Migration Guide\n================\n\nScenario: ${input.slice(0, 60)}\n\n` +
    '**Pre-Migration Checklist:**\n' +
    '- [ ] Full backup of source server (files + database + configs)\n' +
    '- [ ] Verify DNS TTL is set to 300s for quick propagation\n' +
    '- [ ] Document all current services, ports, and configurations\n' +
    '- [ ] Notify users of planned maintenance window\n' +
    '- [ ] Prepare rollback plan\n\n' +
    '**Migration Steps:**\n' +
    '1. Set up target server with matching OS and runtime versions\n' +
    '2. Transfer files: `rsync -avz --progress source:/var/www/ target:/var/www/`\n' +
    '3. Export & import database\n' +
    '4. Update DNS records to point to new server IP\n' +
    '5. Provision SSL certificate on new server\n' +
    '6. Verify all services are running and accessible\n\n' +
    'This is a demo guide. Connect an AI API for platform-specific migration steps with commands and troubleshooting.';
}

function generatePerformanceResponse(input: string): string {
  return `Performance Optimization Report\n==================================\n\nAnalysis Target: ${input.slice(0, 60)}\n\n` +
    '**Identified Bottlenecks:**\n\n' +
    '| Area | Issue | Impact | Fix |\n' +
    '|------|-------|--------|-----|\n' +
    '| Images | Unoptimized uploads | High | Use WebP + lazy loading |\n' +
    '| CSS | Render-blocking resources | Medium | Split critical CSS |\n' +
    '| JS | Large bundle size | High | Code splitting + tree shaking |\n' +
    '| Cache | No browser caching | Medium | Set cache-control headers |\n' +
    '| Server | No compression | Low | Enable gzip/brotli |\n\n' +
    '**Expected Improvement:**\n' +
    '- Load time: 4.2s → 1.5s (-64%)\n' +
    '- Lighthouse Score: 52 → 92 (+40 pts)\n' +
    '- Core Web Vitals: All green\n\n' +
    'This is a demo report. Connect an AI API for site-specific performance audits with exact configuration changes.';
}

function generateTranslationResponse(input: string): string {
  return `Translation Output\n==================\n\nOriginal (${input.slice(0, 50)}):\n"${input.slice(0, 200)}"\n\n` +
    'Translated (Spanish):\n"Esta es una traducción de demostración. Para obtener traducciones precisas y culturalmente adaptadas, configure una clave API de IA en la configuración del servidor."\n\n' +
    '**Translation Notes:**\n' +
    '- Formal register used by default\n' +
    '- Cultural adaptations applied where appropriate\n' +
    '- Technical terms preserved in original language\n\n' +
    'This is a demo translation. Connect an AI API for accurate, context-aware translations between 50+ languages with cultural adaptation notes.';
}


export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    // Find the agent
    const agent = await db.aiAgent.findUnique({ where: { slug } });
    if (!agent || !agent.isActive) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 },
      );
    }

    // Parse request body
    const body = await request.json();
    const { input, config: userConfig } = body as {
      input?: string;
      config?: Record<string, string>;
    };

    if (!input || typeof input !== 'string' || !input.trim()) {
      return NextResponse.json(
        { success: false, error: 'Input is required' },
        { status: 400 },
      );
    }

    // Build the full prompt with any user config
    const agentConfig = (agent.config as Record<string, unknown>) ?? {};
    let systemPrompt = (agentConfig.systemPrompt as string) ?? '';
    let fullInput = input.trim();

    // Inject config into prompt if provided
    if (userConfig) {
      if (userConfig.language && userConfig.language !== 'Auto-detect') {
        fullInput = `[Programming Language: ${userConfig.language}]\n\n${fullInput}`;
      }
      if (userConfig.targetLanguage) {
        fullInput = `[Translate to: ${userConfig.targetLanguage}]\n\n${fullInput}`;
      }
    }

    const startTime = Date.now();

    // Call the LLM
    const result = await callLLM(systemPrompt, fullInput, agentConfig);
    const durationMs = Date.now() - startTime;

    // Store the run in the database
    const run = await db.aiAgentRun.create({
      data: {
        agentId: agent.id,
        input: input.trim(),
        output: result.text,
        model: result.model,
        tokensUsed: result.tokensUsed,
        durationMs,
        status: 'completed',
      },
    });

    // Increment a simple usage counter (update the agent's updatedAt)
    await db.aiAgent.update({
      where: { id: agent.id },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
 output: result.text,
      runId: run.id,
      model: result.model,
      tokensUsed: result.tokensUsed,
      durationMs,
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes('LLM API error')) {
      return NextResponse.json(
        { success: false, error: e.message },
        { status: 502 },
      );
    }
    return handleErr(e);
  }
}
