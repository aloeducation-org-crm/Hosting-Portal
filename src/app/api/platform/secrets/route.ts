import { db } from '@/lib/db'
import { requireSession } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { sealSecretValue, needsSealing, maskSecretValue } from '@/lib/secret-store'
import { NextRequest, NextResponse } from 'next/server'

async function getToken(req: NextRequest) {
  try {
    return await requireSession(req)
  } catch {
    return null
  }
}

const MAX_VALUE_CHARS = 8_000

export async function GET(req: NextRequest) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const secrets = await db.secret.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })

    // Mask secret values in response (never the full value), and lazily
    // re-seal any legacy plaintext row written before encryption-at-rest.
    const masked = []
    for (const s of secrets) {
      if (needsSealing(s.value)) {
        try {
          const sealed = sealSecretValue(s.value)
          await db.secret.update({ where: { id: s.id }, data: { value: sealed } })
          s.value = sealed
        } catch {
          // Best effort: if sealing fails the row stays readable next time.
        }
      }
      masked.push({ ...s, value: maskSecretValue(s.value) })
    }

    return NextResponse.json(masked)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, value, type = 'generic', appId } = body
    if (!name || !value || typeof value !== 'string') {
      return NextResponse.json({ error: 'Name and value are required' }, { status: 400 })
    }
    if (value.length > MAX_VALUE_CHARS) {
      return NextResponse.json({ error: 'Value exceeds maximum length' }, { status: 400 })
    }

    const secret = await db.secret.create({
      data: { userId: user.id, name, value: sealSecretValue(value), type, appId },
    })

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SECRET_CREATED',
      resourceType: 'Secret',
      resourceId: secret.id,
      domain: 'control-plane',
      result: 'SUCCESS',
      metadata: { name: secret.name, type: secret.type, appId: appId ?? null },
    })

    return NextResponse.json({
      ...secret,
      value: maskSecretValue(secret.value),
    }, { status: 201 })
  } catch (error) {
    console.error('Secret POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
