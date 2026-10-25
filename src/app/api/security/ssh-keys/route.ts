import { db } from '@/lib/db'
import { requireSession, requirePermission } from '@/lib/auth'
import { apiError } from '@/lib/response'
import { callHelper, classifyHelperFailure } from '@/lib/helpers'
import { getSshPublicKeyFingerprint } from '@/lib/ssh-key'
import { NextRequest, NextResponse } from 'next/server'

async function getToken(req: NextRequest) {
  try {
    return await requireSession(req);
  } catch {
    return null;
  }
}

function sshKeyType(publicKey: string): string {
  const algorithm = publicKey.trim().split(/\s+/, 1)[0] ?? '';
  if (algorithm === 'ssh-ed25519' || algorithm.startsWith('sk-ssh-ed25519')) return 'ED25519';
  if (algorithm === 'ssh-rsa') return 'RSA';
  if (algorithm.startsWith('ecdsa-') || algorithm.startsWith('sk-ecdsa-')) return 'ECDSA';
  return 'UNKNOWN';
}

export async function GET(req: NextRequest) {
  try {
    const user = await getToken(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const keys = await db.sshKey.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(keys.map((key) => ({
      id: key.id,
      name: key.name,
      type: sshKeyType(key.publicKey),
      fingerprint: key.fingerprint?.replace(/^SHA256:/, '') ?? '',
      createdAt: key.createdAt,
    })))
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    let user
    try {
      user = await requirePermission(req, 'SYSTEM_MANAGE')
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body: unknown = await req.json()
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { name, publicKey } = body as { name?: unknown; publicKey?: unknown }
    if (typeof name !== 'string' || !name.trim() || name.length > 128 || typeof publicKey !== 'string') {
      return NextResponse.json({ error: 'A name (max 128 characters) and publicKey are required' }, { status: 400 })
    }

    let fingerprint: string
    try {
      fingerprint = getSshPublicKeyFingerprint(publicKey)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid SSH public key'
      return NextResponse.json(apiError(message, 'VALIDATION_ERROR', undefined, 400), { status: 400 })
    }

    const helperResult = await callHelper('alo-ssh-helper', ['add-key', publicKey])
    if (!helperResult.success) {
      const failure = classifyHelperFailure('alo-ssh-helper', helperResult)
      return NextResponse.json(apiError(failure.message, failure.code), { status: failure.status })
    }

    try {
      const key = await db.sshKey.create({
        data: { userId: user.id, name: name.trim(), publicKey, fingerprint },
      })
      return NextResponse.json({
        id: key.id,
        name: key.name,
        type: sshKeyType(key.publicKey),
        fingerprint: key.fingerprint?.replace(/^SHA256:/, '') ?? '',
        createdAt: key.createdAt,
      }, { status: 201 })
    } catch (error) {
      await callHelper('alo-ssh-helper', ['remove-key', fingerprint])
      throw error
    }
  } catch (error) {
    console.error('SSH Key POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}