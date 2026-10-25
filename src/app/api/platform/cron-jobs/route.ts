import { db } from '@/lib/db'
import { requireRole, ROLES } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

async function getToken(req: NextRequest) {
  try {
    return await requireRole(req, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getToken(req)
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
    const user = await getToken(req)
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