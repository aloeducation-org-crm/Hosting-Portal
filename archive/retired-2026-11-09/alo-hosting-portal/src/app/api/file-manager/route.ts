import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requirePermission } from '@/lib/auth';
import { callHelper } from '@/lib/helpers';
import { db } from '@/lib/db';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import { env } from '@/lib/env';

const listSchema = z.object({
  websiteId: z.string().uuid(),
  path: z.string().default('/').transform(sanitizePath),
});

const readSchema = z.object({
  websiteId: z.string().uuid(),
  path: z.string().min(1).transform(sanitizePath),
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
  newName: z.string().min(1).max(255),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

// Path traversal protection
function sanitizePath(p: string): string {
  const normalized = path.posix.normalize(p);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid path');
  }
  return normalized;
}

async function getWebsiteDomain(websiteId: string) {
  const website = await db.website.findUnique({ where: { id: websiteId } });
  if (!website || website.deletedAt) return null;
  return website.domain;
}

// List files
export async function GET(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'FILE_MANAGE');
    const { searchParams } = new URL(request.url);
    const input = listSchema.parse(Object.fromEntries(searchParams));

    const domain = await getWebsiteDomain(input.websiteId);
    if (!domain) return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });

    const result = await callHelper('alo-file-manager-helper', ['list', domain, input.path]);
    if (!result.success) {
      return NextResponse.json(apiError('Failed to list files', 'FILE_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    let data;
    try { data = JSON.parse(result.stdout); } catch { data = { entries: [] }; }
    return NextResponse.json(apiSuccess(data));
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    return handleErr(e);
  }
}

// Create directory or upload file
export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'FILE_MANAGE');
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // File upload
      const formData = await request.formData();
      const websiteId = formData.get('websiteId') as string;
      const relativePath = formData.get('path') as string;
      const file = formData.get('file') as File;

      if (!websiteId || !relativePath || !file) {
        return NextResponse.json(apiError('Missing required fields', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
      }

      const domain = await getWebsiteDomain(websiteId);
      if (!domain) return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });

      // Validate file size
      const maxBytes = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
      if (file.size > maxBytes) {
        return NextResponse.json(apiError(`File too large (max ${env.MAX_UPLOAD_SIZE_MB}MB)`, 'FILE_TOO_LARGE', undefined, 413), { status: 413 });
      }

      // Save to temp file first
      const bytes = await file.arrayBuffer();
      const tmpPath = `/tmp/alo-upload-${Date.now()}`;
      await mkdir(path.dirname(tmpPath), { recursive: true });
      await writeFile(tmpPath, Buffer.from(bytes));

      const result = await callHelper('alo-file-manager-helper', ['upload', domain, relativePath, tmpPath]);
      if (!result.success) {
        return NextResponse.json(apiError('Upload failed', 'FILE_ERROR', { stderr: result.stderr }), { status: 500 });
      }

      let data;
      try { data = JSON.parse(result.stdout); } catch { data = {}; }
      return NextResponse.json(apiSuccess(data, 'File uploaded', 201), { status: 201 });
    } else {
      // JSON body - mkdir or rename
      const body = await request.json();

      if (body.action === 'mkdir') {
        const input = mkdirSchema.parse(body);
        const domain = await getWebsiteDomain(input.websiteId);
        if (!domain) return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });

        const result = await callHelper('alo-file-manager-helper', ['mkdir', domain, input.path]);
        if (!result.success) {
          return NextResponse.json(apiError('Failed to create directory', 'FILE_ERROR', { stderr: result.stderr }), { status: 500 });
        }

        return NextResponse.json(apiSuccess(JSON.parse(result.stdout), 'Directory created', 201), { status: 201 });
      }

      if (body.action === 'rename') {
        const input = renameSchema.parse(body);
        const domain = await getWebsiteDomain(input.websiteId);
        if (!domain) return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });

        const result = await callHelper('alo-file-manager-helper', ['rename', domain, input.path, input.newName]);
        if (!result.success) {
          return NextResponse.json(apiError('Rename failed', 'FILE_ERROR', { stderr: result.stderr }), { status: 500 });
        }

        return NextResponse.json(apiSuccess(JSON.parse(result.stdout)));
      }

      return NextResponse.json(apiError('Invalid action. Use action: mkdir or rename', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    return handleErr(e);
  }
}

// Delete files
export async function DELETE(request: NextRequest) {
  try {
    const user = await requirePermission(request, 'FILE_MANAGE');
    const { searchParams } = new URL(request.url);
    const input = deleteSchema.parse(Object.fromEntries(searchParams));

    const domain = await getWebsiteDomain(input.websiteId);
    if (!domain) return NextResponse.json(apiError('Website not found', 'NOT_FOUND', undefined, 404), { status: 404 });

    const result = await callHelper('alo-file-manager-helper', ['delete', domain, input.path]);
    if (!result.success) {
      return NextResponse.json(apiError('Delete failed', 'FILE_ERROR', { stderr: result.stderr }), { status: 500 });
    }

    let data;
    try { data = JSON.parse(result.stdout); } catch { data = {}; }
    return NextResponse.json(apiSuccess(data, 'Deleted'));
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    return handleErr(e);
  }
}
