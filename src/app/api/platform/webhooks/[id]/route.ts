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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const webhook = await db.webhook.findFirst({ where: { id, userId: user.id } })
    if (!webhook) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

    await db.webhook.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Webhook DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}