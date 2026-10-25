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

    const jobs = await db.cronJob.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(jobs)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, schedule, command, appId } = body
    if (!name || !schedule || !command) {
      return NextResponse.json({ error: 'Name, schedule, and command are required' }, { status: 400 })
    }

    const job = await db.cronJob.create({
      data: {
        websiteId: appId ?? 'default',
        name,
        schedule,
        command,
      },
    })
    return NextResponse.json(job, { status: 201 })
  } catch (error) {
    console.error('CronJob POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}