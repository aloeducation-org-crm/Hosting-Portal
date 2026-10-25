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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json()
    const { type, name, value, ttl, priority, proxied } = body

    const record = await db.dnsRecord.findFirst({ where: { id } })
    if (!record) return NextResponse.json({ error: 'DNS record not found' }, { status: 404 })

    const updated = await db.dnsRecord.update({
      where: { id },
      data: {
        ...(type !== undefined ? { type } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(value !== undefined ? { value } : {}),
        ...(ttl !== undefined ? { ttl: Number(ttl) } : {}),
        ...(priority !== undefined ? { priority: priority !== null ? Number(priority) : null } : {}),
        ...(proxied !== undefined ? { proxied } : {}),
      },
    })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('DNS PUT error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const record = await db.dnsRecord.findFirst({ where: { id } })
    if (!record) return NextResponse.json({ error: 'DNS record not found' }, { status: 404 })

    await db.dnsRecord.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DNS DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}