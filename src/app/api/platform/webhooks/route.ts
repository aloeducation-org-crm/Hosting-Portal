import { db } from '@/lib/db'
import { verifyToken } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

function getToken(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const payload = verifyToken(auth.slice(7))
  if (!payload || typeof payload !== 'object' || !('id' in payload)) return null
  return payload as { id: string }
}

export async function GET(req: NextRequest) {
  try {
    const user = getToken(req)
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
    const user = getToken(req)
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