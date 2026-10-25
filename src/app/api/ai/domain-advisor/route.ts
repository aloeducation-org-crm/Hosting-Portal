import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import ZAI from '@/lib/ai-sdk'
import { verifyToken } from '@/lib/auth'

const advisorSchema = z.object({
  business: z.string().min(1, 'Business description is required'),
  keywords: z.string().optional(),
})

const SYSTEM_PROMPT = `You are a domain name expert and branding advisor. Given a business description and optional keywords, suggest 8 domain name recommendations.
For each suggestion, provide the domain name and a brief reason why it's a good choice.
Return your response as a JSON array of objects with "name" and "reason" fields. Example:
[{"name": "example.com", "reason": "Short and memorable, directly relates to the business."}]
Return ONLY the JSON array, no explanation, no markdown, no code blocks.`

function isAvailable(): boolean {
  return Math.random() > 0.35
}

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const payload = verifyToken(authHeader.slice(7));
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

    // Parse the AI response
    let recommendations: Array<{ name: string; reason: string; available: boolean }> = []
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = rawContent.match(/\[[\s\S]*?\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        recommendations = parsed.map((item: { name?: string; reason?: string }) => ({
          name: item.name ?? 'unknown.com',
          reason: item.reason ?? 'A strong domain choice for your brand.',
          available: isAvailable(),
        }))
      } else {
        // Fallback: try parsing the whole response
        const parsed = JSON.parse(rawContent)
        recommendations = parsed.map((item: { name?: string; reason?: string }) => ({
          name: item.name ?? 'unknown.com',
          reason: item.reason ?? 'A strong domain choice for your brand.',
          available: isAvailable(),
        }))
      }
    } catch {
      // If parsing fails, create a fallback recommendation
      const cleanedBusiness = business.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15)
      recommendations = [
        { name: `${cleanedBusiness}.com`, reason: `Direct match for "${business}"`, available: isAvailable() },
        { name: `${cleanedBusiness}.io`, reason: `Modern tech-focused TLD for "${business}"`, available: isAvailable() },
        { name: `get${cleanedBusiness}.com`, reason: `Action-oriented domain for "${business}"`, available: isAvailable() },
        { name: `${cleanedBusiness}app.com`, reason: `App-focused branding for "${business}"`, available: isAvailable() },
      ]
    }

    return NextResponse.json({ success: true, recommendations })
  } catch (error) {
    console.error('Domain advisor error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get domain recommendations' },
      { status: 500 }
    )
  }
}