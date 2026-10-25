import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyToken } from '@/lib/auth'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = verifyToken(authHeader.slice(7))
    if (!payload || typeof payload !== 'object' || !('id' in payload)) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    const userId = (payload as { id: string }).id
    const { id } = await params
    const body = await request.json()

    const existing = await db.crmPipeline.findFirst({ where: { id, userId } })
    if (!existing) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })
    }

    const { name, stages, isDefault } = body

    const pipeline = await db.crmPipeline.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(stages !== undefined && {
          stages: Array.isArray(stages) ? stages.join(',') : stages,
        }),
        ...(isDefault !== undefined && { isDefault }),
      },
    })

    return NextResponse.json({ pipeline })
  } catch (error) {
    console.error('Pipeline update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = verifyToken(authHeader.slice(7))
    if (!payload || typeof payload !== 'object' || !('id' in payload)) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    const userId = (payload as { id: string }).id
    const { id } = await params

    const existing = await db.crmPipeline.findFirst({ where: { id, userId } })
    if (!existing) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })
    }

    await db.crmDeal.deleteMany({ where: { pipelineId: id } })
    await db.crmPipeline.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Pipeline delete error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}