import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission, assertWebsiteAccess, type AuthUser } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import { env } from '@/lib/env';

const listSchema = z.object({
  websiteId: z.string().uuid(),
  path: z.string().default('/').transform(sanitizePath),
});

const deleteSchema = z.object({
  websiteId: z.string().uuid(),
  path: z.string().min(1).transform(sanitizePath),
});

const mkdirSchema = z.object({
  websiteId: z.string().uuid(),
  path: z.string().min(1).transform(sanitizePath),
});

const renameSchema = z.object({
  websiteId: z.string().uuid(),
  path: z.string().min(1).transform(sanitizePath),
  newName: z
    .string()
    .min(1)
    .max(255)
    .refine((name) => !name.includes('/') && !name.includes('\\') && !name.includes('\0') && name !== '.' && name !== '..', 'Invalid file name'),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

// Path traversal protection
export function sanitizePath(p: string): string {
  if (p.includes('\0') || p.includes('\\')) throw new Error('Invalid path');
  const relative = p.trim().replace(/^\/+/, '');
  const normalized = path.posix.normalize(relative);
  if (normalized === '.' || normalized === '') return '/';
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error('Invalid path');
  }
  return normalized;
}

async function getAuthorizedWebsiteDomain(websiteId: string, user: AuthUser): Promise<string | null> {
  const website = await db.website.findUnique({ where: { id: websiteId } });
  if (!website || website.deletedAt) return null;
  assertWebsiteAccess(user, website);
  return website.domain;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'FILE_MANAGE');
    const { searchParams } = new URL(request.url);
    const input = listSchema.parse(Object.fromEntries(searchParams));

    const domain = await getAuthorizedWebsiteDomain(input.websiteId, user);
    if (!domain) return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });

    const result = await callHelper('alo-file-manager-helper', ['list', domain, input.path]);
    if (!result.success) {
      return NextResponse.json(apiError('Failed to list files', 'FILE_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    let data;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      data = { entries: [] };
    }
    return NextResponse.json(apiSuccess(data));
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'FILE_MANAGE');
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const websiteIdRaw = formData.get('websiteId');
      const relativePathRaw = formData.get('path');
      const file = formData.get('file');

      if (typeof websiteIdRaw !== 'string' || typeof relativePathRaw !== 'string' || !(file instanceof File)) {
        return NextResponse.json(apiError('Missing required fields', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
      }

      const uploadMeta = z.object({
        websiteId: z.string().uuid(),
        path: z.string().min(1).transform(sanitizePath),
      }).parse({ websiteId: websiteIdRaw, path: relativePathRaw });

      const domain = await getAuthorizedWebsiteDomain(uploadMeta.websiteId, user);
      if (!domain) return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });

      const maxBytes = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
      if (file.size > maxBytes) {
        return NextResponse.json(apiError(`File too large (max ${env.MAX_UPLOAD_SIZE_MB}MB)`, 'FILE_TOO_LARGE', undefined, 413), { status: 413 });
      }

      const bytes = await file.arrayBuffer();
      const tmpPath = `/tmp/alo-upload-${randomUUID()}`;
      await mkdir(path.dirname(tmpPath), { recursive: true });
      await writeFile(tmpPath, Buffer.from(bytes), { mode: 0o600 });

      try {
        const result = await callHelper('alo-file-manager-helper', ['upload', domain, uploadMeta.path, tmpPath]);
        if (!result.success) {
          return NextResponse.json(apiError('Upload failed', 'FILE_ERROR', { stderr: result.stderr }), { status: 500 });
        }

        let data;
        try {
          data = JSON.parse(result.stdout);
        } catch {
          data = {};
        }
        return NextResponse.json(apiSuccess(data, 'File uploaded', 201), { status: 201 });
      } finally {
        await unlink(tmpPath).catch(() => {});
      }
    }

    const body = await request.json();

    if (body.action === 'mkdir') {
      const input = mkdirSchema.parse(body);
      const domain = await getAuthorizedWebsiteDomain(input.websiteId, user);
      if (!domain) return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });

      const result = await callHelper('alo-file-manager-helper', ['mkdir', domain, input.path]);
      if (!result.success) {
        return NextResponse.json(apiError('Failed to create directory', 'FILE_ERROR', { stderr: result.stderr }), { status: 500 });
      }

      return NextResponse.json(apiSuccess(JSON.parse(result.stdout), 'Directory created', 201), { status: 201 });
    }

    if (body.action === 'rename') {
      const input = renameSchema.parse(body);
      const domain = await getAuthorizedWebsiteDomain(input.websiteId, user);
      if (!domain) return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });

      const result = await callHelper('alo-file-manager-helper', ['rename', domain, input.path, input.newName]);
      if (!result.success) {
        return NextResponse.json(apiError('Rename failed', 'FILE_ERROR', { stderr: result.stderr }), { status: 500 });
      }

      return NextResponse.json(apiSuccess(JSON.parse(result.stdout)));
    }

    return NextResponse.json(apiError('Invalid action. Use action: mkdir or rename', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    return handleErr(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'FILE_MANAGE');
    const { searchParams } = new URL(request.url);
    const input = deleteSchema.parse(Object.fromEntries(searchParams));

    const domain = await getAuthorizedWebsiteDomain(input.websiteId, user);
    if (!domain) return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });

    const result = await callHelper('alo-file-manager-helper', ['delete', domain, input.path]);
    if (!result.success) {
      return NextResponse.json(apiError('Delete failed', 'FILE_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    let data;
    try {
      data = JSON.parse(result.stdout);
    } catch {
      data = {};
    }
    return NextResponse.json(apiSuccess(data, 'Deleted'));
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    return handleErr(e);
  }
}
