import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import ZAI from '@/lib/ai-sdk'
import { verifyToken } from '@/lib/auth'

const codeSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  language: z.string().optional(),
})

const SYSTEM_PROMPT =
  'You are an expert programmer (GPT-5 level). Generate clean, production-ready code. Always provide the code in a code block with the appropriate language tag. After the code block, provide a brief explanation of what the code does and any important notes.'

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
    const parsed = codeSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { prompt, language } = parsed.data

    const languageHint = language
      ? ` The code should be in ${language}.`
      : ''

    const zai = await ZAI.create()
    const result = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${prompt}${languageHint}`,
        },
      ],
    })

    const rawContent = result.choices?.[0]?.message?.content ?? ''

    // Extract code block and explanation
    const codeBlockMatch = rawContent.match(/```[\w]*\n([\s\S]*?)```/)
    const code = codeBlockMatch ? codeBlockMatch[1]!.trim() : rawContent.trim()

    // Explanation is everything after the code block, or a default message
    let explanation = ''
    if (codeBlockMatch) {
      const afterCode = rawContent.slice((codeBlockMatch.index ?? 0) + codeBlockMatch[0].length).trim()
      explanation = afterCode || 'Code generated successfully based on your prompt.'
    } else {
      explanation = 'Code generated successfully based on your prompt.'
    }

    return NextResponse.json({ success: true, code, explanation })
  } catch (error) {
    console.error('AI code generation error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to generate code' },
      { status: 500 }
    )
  }
}