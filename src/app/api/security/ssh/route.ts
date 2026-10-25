import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { callHelper, classifyHelperFailure } from '@/lib/helpers';
import { getSshPublicKeyFingerprint } from '@/lib/ssh-key';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

function parseHelperJson(stdout: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return { raw: stdout };
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SYSTEM_MANAGE');

    // === REAL: List SSH keys from authorized_keys ===
    const result = await callHelper('alo-ssh-helper', ['list-keys']);

    if (!result.success) {
      const failure = classifyHelperFailure('alo-ssh-helper', result);
      return NextResponse.json(apiError(failure.message, failure.code), { status: failure.status });
    }

    const serverKeys = parseHelperJson(result.stdout);

    // Also return DB records
    const where = user.role === ROLES.SUPER_ADMIN ? {} : { userId: user.id };
    const dbKeys = await db.sshKey.findMany({ where, take: 50 });

    return NextResponse.json(
      apiSuccess({
        serverKeys: serverKeys.keys ?? [],
        managedKeys: dbKeys,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SYSTEM_MANAGE');
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') {
      throw apiError('Invalid request body', 'VALIDATION_ERROR', undefined, 400);
    }
    const { publicKey, label, name } = body as {
      publicKey?: unknown;
      label?: unknown;
      name?: unknown;
    };

    if (!publicKey || typeof publicKey !== 'string') {
      throw apiError('publicKey is required', 'VALIDATION_ERROR', undefined, 400);
    }

    if ((label !== undefined && typeof label !== 'string') || (name !== undefined && typeof name !== 'string')) {
      throw apiError('name and label must be strings', 'VALIDATION_ERROR', undefined, 400);
    }
    if (typeof name === 'string' && name.length > 128) {
      throw apiError('name must be at most 128 characters', 'VALIDATION_ERROR', undefined, 400);
    }

    let fingerprint: string;
    try {
      fingerprint = getSshPublicKeyFingerprint(publicKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid SSH public key';
      throw apiError(message, 'VALIDATION_ERROR', undefined, 400);
    }

    // === REAL: Add SSH key to authorized_keys ===
    const helperArgs = ['add-key', publicKey];
    if (label) helperArgs.push(label);

    const result = await callHelper('alo-ssh-helper', helperArgs);

    if (!result.success) {
      const failure = classifyHelperFailure('alo-ssh-helper', result);
      throw apiError(failure.message, failure.code, undefined, failure.status);
    }

    const keyType = publicKey.trim().split(/\s+/, 1)[0] || 'unknown';

    // Save to DB for tracking
    const keyRecord = await db.sshKey.create({
      data: {
        name: name || label || `${keyType}-${Date.now()}`,
        publicKey,
        fingerprint,
        userId: user.id,
      },
    });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SSH_KEY_ADDED',
      resourceType: 'SshKey',
      resourceId: keyRecord.id,
      result: 'SUCCESS',
      metadata: { name: keyRecord.name, keyType, label },
    });

    return NextResponse.json(
      apiSuccess(keyRecord, 'SSH key added to authorized_keys'),
      { status: 201 },
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'SYSTEM_MANAGE');
    const { searchParams } = new URL(request.url);
    const keyId = searchParams.get('keyId');
    const fingerprint = searchParams.get('fingerprint');

    if (!keyId && !fingerprint) {
      throw apiError('keyId or fingerprint is required', 'VALIDATION_ERROR', undefined, 400);
    }

    let targetFingerprint = fingerprint || '';

    // If keyId provided, look up fingerprint from DB
    if (keyId) {
      const keyRecord = await db.sshKey.findUnique({ where: { id: keyId } });
      if (!keyRecord) {
        throw apiError('SSH key not found', 'NOT_FOUND', undefined, 404);
      }
      targetFingerprint = keyRecord.fingerprint ?? '';

      // Non-admin can only delete own keys
      if (user.role !== ROLES.SUPER_ADMIN && keyRecord.userId !== user.id) {
        throw apiError('You can only delete your own SSH keys', 'FORBIDDEN', undefined, 403);
      }
    }

    if (!targetFingerprint) {
      throw apiError(
        'The saved SSH key has no fingerprint; it cannot be safely removed from the host.',
        'SSH_FINGERPRINT_MISSING',
        undefined,
        409,
      );
    }

    // Remove the host key first. Keep the DB record if host removal fails so
    // the operator can retry and the UI never reports a false success.
    const result = await callHelper('alo-ssh-helper', ['remove-key', targetFingerprint]);
    if (!result.success) {
      const failure = classifyHelperFailure('alo-ssh-helper', result);
      throw apiError(failure.message, failure.code, undefined, failure.status);
    }

    if (keyId) {
      await db.sshKey.delete({ where: { id: keyId } });
    }

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SSH_KEY_REMOVED',
      resourceType: 'SshKey',
      resourceId: keyId || '',
      result: 'SUCCESS',
      metadata: { fingerprint: targetFingerprint },
    });

    return NextResponse.json(apiSuccess(null, 'SSH key removed from authorized_keys'));
  } catch (e) {
    return handleErr(e);
  }
}
