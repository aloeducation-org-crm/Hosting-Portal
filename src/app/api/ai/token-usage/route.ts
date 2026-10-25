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

    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const where: Record<string, unknown> = { userId: user.id }
    if (from || to) {
      const createdAt: Record<string, unknown> = {}
      if (from) createdAt.gte = new Date(from)
      if (to) createdAt.lte = new Date(to)
      where.createdAt = createdAt
    }

    const usage = await db.tokenUsage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    // Aggregate stats
    const totalTokens = usage.reduce((sum, u) => sum + u.totalTokens, 0)
    const totalCost = usage.reduce((sum, u) => sum + u.costUsd, 0)

    return NextResponse.json({ data: usage, totalTokens, totalCost: Math.round(totalCost * 10000) / 10000 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}