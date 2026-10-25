import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyToken } from '@/lib/auth'

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const payload = verifyToken(authHeader.slice(7))
  if (!payload || typeof payload !== 'object' || !('id' in payload)) return null
  return payload as { id: string }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const deployments = await db.deployment.findMany({
      where: { website: { applications: { some: { userId: user.id } } } },
      include: { website: { select: { id: true, domain: true } } },
      orderBy: { startedAt: 'desc' },
      take: 50,
    })
    return NextResponse.json(deployments)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}