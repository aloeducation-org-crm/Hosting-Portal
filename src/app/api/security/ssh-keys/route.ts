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

    const keys = await db.sshKey.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(keys)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, publicKey } = body
    if (!name || !publicKey) {
      return NextResponse.json({ error: 'Name and publicKey are required' }, { status: 400 })
    }

    // Generate a fingerprint-like hash for display
    const fingerprint = 'SHA256:' + Buffer.from(publicKey.slice(0, 32)).toString('base64url').slice(0, 43)

    const key = await db.sshKey.create({
      data: { userId: user.id, name, publicKey, fingerprint },
    })
    return NextResponse.json(key, { status: 201 })
  } catch (error) {
    console.error('SSH Key POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}