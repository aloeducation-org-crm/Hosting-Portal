import { db } from '@/lib/db'
import { requireSession } from '@/lib/auth'
import { validateExternalWebhookUrl } from '@/lib/security/url-guard'
import { NextRequest, NextResponse } from 'next/server'

async function getToken(req: NextRequest) {
  try {
    return await requireSession(req)
  } catch {
    return null
  }
}

function redactWebhook<T extends { secret?: string | null }>(row: T) {
  const { secret, ...rest } = row
  return {
    ...rest,
    hasSecret: Boolean(secret),
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const webhooks = await db.webhook.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(webhooks.map(redactWebhook))
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    const secret = typeof body.secret === 'string' && body.secret.trim() ? body.secret.trim() : null
    const events = Array.isArray(body.events)
      ? body.events.filter((e): e is string => typeof e === 'string' && e.length <= 64).slice(0, 32)
      : ['*']

    if (!name || name.length > 120 || !url) {
      return NextResponse.json({ error: 'Valid name (1-120 chars) and url are required' }, { status: 400 })
    }

    const urlCheck = validateExternalWebhookUrl(url)
    if (!urlCheck.ok || !urlCheck.normalizedUrl) {
      return NextResponse.json(
        { error: urlCheck.reason ?? 'Invalid webhook URL', code: 'INVALID_WEBHOOK_URL' },
        { status: 400 },
      )
    }

    if (secret && secret.length > 256) {
      return NextResponse.json({ error: 'Webhook secret exceeds maximum length (256)' }, { status: 400 })
    }

    const webhook = await db.webhook.create({
      data: {
        userId: user.id,
        name,
        url: urlCheck.normalizedUrl,
        secret,
        events: JSON.stringify(events.length ? events : ['*']),
      },
    })
    return NextResponse.json(redactWebhook(webhook), { status: 201 })
  } catch (error) {
    console.error('Webhook POST error:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
