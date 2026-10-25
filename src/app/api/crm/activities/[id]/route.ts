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

    const existing = await db.crmActivity.findFirst({ where: { id, userId } })
    if (!existing) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
    }

    const { type, subject, description, contactId, dealId, dueDate, completed } = body

    const activity = await db.crmActivity.update({
      where: { id },
      data: {
        ...(type !== undefined && { type }),
        ...(subject !== undefined && { subject }),
        ...(description !== undefined && { description }),
        ...(contactId !== undefined && { contactId: contactId || null }),
        ...(dealId !== undefined && { dealId: dealId || null }),
        ...(dueDate !== undefined && {
          dueDate: dueDate ? new Date(dueDate) : null,
        }),
        ...(completed !== undefined && { completed }),
      },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true },
        },
        deal: {
          select: { id: true, title: true },
        },
      },
    })

    return NextResponse.json({ activity })
  } catch (error) {
    console.error('Activity update error:', error)
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

    const existing = await db.crmActivity.findFirst({ where: { id, userId } })
    if (!existing) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
    }

    await db.crmActivity.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Activity delete error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}