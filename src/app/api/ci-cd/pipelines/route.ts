import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/auth'

async function getUser(req: NextRequest) {
  try {
    return await requireSession(req);
  } catch {
    return null;
  }
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