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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json()
    const { name, category, content, variables } = body

    const template = await db.promptTemplate.findFirst({ where: { id, userId: user.id } })
    if (!template) return NextResponse.json({ error: 'Prompt template not found' }, { status: 404 })

    const updated = await db.promptTemplate.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(variables !== undefined ? { variables: JSON.stringify(variables) } : {}),
      },
    })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('Prompt PUT error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const template = await db.promptTemplate.findFirst({ where: { id, userId: user.id } })
    if (!template) return NextResponse.json({ error: 'Prompt template not found' }, { status: 404 })

    await db.promptTemplate.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Prompt DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}