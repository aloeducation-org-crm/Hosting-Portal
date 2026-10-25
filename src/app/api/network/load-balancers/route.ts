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

    const lbs = await db.loadBalancer.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(lbs)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, protocol = 'http', port = 443, algorithm = 'round_robin', targets = [], sslCertId } = body
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const lb = await db.loadBalancer.create({
      data: {
        userId: user.id,
        name,
        protocol,
        port: Number(port),
        algorithm,
        targets: JSON.stringify(targets),
        sslCertId,
        status: 'active',
      },
    })
    return NextResponse.json(lb, { status: 201 })
  } catch (error) {
    console.error('LoadBalancer POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}