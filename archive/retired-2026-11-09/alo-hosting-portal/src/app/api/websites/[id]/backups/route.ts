import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, requirePermission } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const backups = await db.backup.findMany({
      where: { websiteId: id },
      orderBy: { createdAt: 'desc' },
      include: { manifest: true },
    });
    return NextResponse.json(apiSuccess(backups));
  } catch (e) { return handleErr(e); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission(request, 'BACKUP_CREATE');
    const { id } = await params;

    const website = await db.website.findUnique({ where: { id } });
    if (!website || website.deletedAt) {
      return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });
    }

    const result = await callHelper('alo-site-backup', ['create', website.domain]);
    if (!result.success) {
      return NextResponse.json(apiError('Backup failed', 'HELPER_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = { raw: result.stdout };
    }

    const backup = await db.backup.create({
      data: {
        websiteId: id,
        filename: String(parsed.filename ?? 'backup.tar.gz'),
        filepath: String(parsed.filepath ?? '/unknown'),
        fileSize: BigInt(Math.floor(Number(parsed.sizeBytes ?? 0))),
        checksum: String(parsed.checksum ?? ''),
        status: 'COMPLETED',
        creatorId: user.id,
      },
    });

    await db.backupManifest.create({
      data: {
        backupId: backup.id,
        files: parsed.files ?? [],
      },
    });

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip');
    await db.auditLog.create({
      data: {
        actorUserId: user.id, actorEmail: user.email, actorRole: user.role,
        action: 'BACKUP_CREATE', resourceType: 'Backup', resourceId: backup.id,
        domain: website.domain, result: 'SUCCESS', ipAddress: ip,
      },
    });

    return NextResponse.json(apiSuccess(backup, 'Backup created', 201), { status: 201 });
  } catch (e) { return handleErr(e); }
}
