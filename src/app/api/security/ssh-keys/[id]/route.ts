import { db } from '@/lib/db'
import { requirePermission } from '@/lib/auth'
import { apiError } from '@/lib/response'
import { callHelper, classifyHelperFailure } from '@/lib/helpers'
import { NextRequest, NextResponse } from 'next/server'

async function getToken(req: NextRequest) {
  try {
    return await requirePermission(req, 'SYSTEM_MANAGE');
  } catch {
    return null;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const key = await db.sshKey.findFirst({ where: { id, userId: user.id } })
    if (!key) return NextResponse.json({ error: 'SSH key not found' }, { status: 404 })

    if (!key.fingerprint) {
      return NextResponse.json(
        apiError('The saved SSH key has no valid fingerprint and cannot be safely removed from the host.', 'SSH_FINGERPRINT_MISSING', undefined, 409),
        { status: 409 },
      )
    }

    const result = await callHelper('alo-ssh-helper', ['remove-key', key.fingerprint])
    if (!result.success) {
      const failure = classifyHelperFailure('alo-ssh-helper', result)
      return NextResponse.json(apiError(failure.message, failure.code), { status: failure.status })
    }

    await db.sshKey.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('SSH Key DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}