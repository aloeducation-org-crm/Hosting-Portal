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

function maskValue(value: string): string {
  if (value.length <= 4) return '****'
  return value.slice(0, 4) + '***'
}

export async function GET(req: NextRequest) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const secrets = await db.secret.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })

    // Mask secret values in response
    const masked = secrets.map((s) => ({
      ...s,
      value: maskValue(s.value),
    }))

    return NextResponse.json(masked)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, value, type = 'generic', appId } = body
    if (!name || !value) {
      return NextResponse.json({ error: 'Name and value are required' }, { status: 400 })
    }

    const secret = await db.secret.create({
      data: { userId: user.id, name, value, type, appId },
    })

    return NextResponse.json({
      ...secret,
      value: maskValue(secret.value),
    }, { status: 201 })
  } catch (error) {
    console.error('Secret POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}