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

    const existing = await db.crmDeal.findFirst({ where: { id, userId } })
    if (!existing) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const { title, value, currency, contactId, pipelineId, stage, probability, expectedCloseDate, notes } = body

    const deal = await db.crmDeal.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(value !== undefined && { value: Number(value) }),
        ...(currency !== undefined && { currency }),
        ...(contactId !== undefined && { contactId: contactId || null }),
        ...(pipelineId !== undefined && { pipelineId: pipelineId || null }),
        ...(stage !== undefined && { stage }),
        ...(probability !== undefined && { probability: Number(probability) }),
        ...(expectedCloseDate !== undefined && {
          expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        }),
        ...(notes !== undefined && { notes }),
      },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, email: true, company: true },
        },
      },
    })

    return NextResponse.json({ deal })
  } catch (error) {
    console.error('Deal update error:', error)
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

    const existing = await db.crmDeal.findFirst({ where: { id, userId } })
    if (!existing) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    await db.crmActivity.deleteMany({ where: { dealId: id } })
    await db.crmDeal.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Deal delete error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}