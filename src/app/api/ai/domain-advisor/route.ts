import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import ZAI from '@/lib/ai-sdk'
import { AIProviderError } from '@/lib/ai-provider'
import { requireSession } from '@/lib/auth'

const advisorSchema = z.object({
  business: z.string().min(1, 'Business description is required'),
  keywords: z.string().optional(),
})

const SYSTEM_PROMPT = `You are a domain name expert and branding advisor. Given a business description and optional keywords, suggest 8 domain name recommendations.
For each suggestion, provide the domain name and a brief reason why it's a good choice.
Return your response as a JSON array of objects with "name" and "reason" fields. Example:
[{"name": "example.com", "reason": "Short and memorable, directly relates to the business."}]
Return ONLY the JSON array, no explanation, no markdown, no code blocks.`

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const payload = await requireSession(request);
    const userId = payload && typeof payload === 'object' && 'id' in payload ? (payload as { id: string }).id : null;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json()
    const parsed = advisorSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { business, keywords } = parsed.data

    const keywordHint = keywords
      ? ` Keywords to consider: ${keywords}.`
      : ''

    const zai = await ZAI.create()
    const result = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Business: ${business}.${keywordHint} Suggest domain names with appropriate TLDs (.com, .io, .ai, .dev, .app, .co, .net, .org).`,
        },
      ],
    })

    const rawContent = result.choices?.[0]?.message?.content ?? ''

    // AI can suggest names, but registrar availability is a separate real lookup.
    const jsonMatch = rawContent.match(/\[[\s\S]*?\]/)
    if (!jsonMatch) {
      return NextResponse.json({ success: false, error: 'AI provider returned an invalid response' }, { status: 502 })
    }
    const aiParsed: unknown = JSON.parse(jsonMatch[0])
    if (!Array.isArray(aiParsed)) {
      return NextResponse.json({ success: false, error: 'AI provider returned an invalid response' }, { status: 502 })
    }
    const recommendations = aiParsed.flatMap((item): Array<{ name: string; reason: string; availability: 'UNKNOWN' }> => {
      if (!item || typeof item.name !== 'string' || typeof item.reason !== 'string') return []
      return [{ name: item.name, reason: item.reason, availability: 'UNKNOWN' }]
    })
    return NextResponse.json({ success: true, recommendations })
  } catch (error) {
    if (error instanceof AIProviderError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ success: false, error: 'Failed to get domain recommendations' }, { status: 500 })
  }
}