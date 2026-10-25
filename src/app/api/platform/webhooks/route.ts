import { db } from '@/lib/db'
import { requireSession } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

async function getToken(req: NextRequest) {
  try {
    return await requireSession(req);
  } catch {
    return null;
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
    return NextResponse.json(webhooks)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, url, secret, events = ['*'] } = body
    if (!name || !url) {
      return NextResponse.json({ error: 'Name and url are required' }, { status: 400 })
    }

    const webhook = await db.webhook.create({
      data: {
        userId: user.id,
        name,
        url,
        secret,
        events: JSON.stringify(events),
      },
    })
    return NextResponse.json(webhook, { status: 201 })
  } catch (error) {
    console.error('Webhook POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}