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

    const workflows = await db.aiWorkflow.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(workflows)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, description, nodes = [], edges = [] } = body
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const workflow = await db.aiWorkflow.create({
      data: {
        userId: user.id,
        name,
        description,
        nodes: JSON.stringify(nodes),
        edges: JSON.stringify(edges),
        status: 'draft',
      },
    })
    return NextResponse.json(workflow, { status: 201 })
  } catch (error) {
    console.error('Workflow POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}