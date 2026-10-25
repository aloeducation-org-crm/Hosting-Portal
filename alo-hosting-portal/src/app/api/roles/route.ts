import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    if (auth.role !== ROLES.SUPER_ADMIN) {
      return NextResponse.json(apiError('Only SUPER_ADMIN can manage roles', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const roles = await db.role.findMany({
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const rolesWithPermissions = roles.map((role) => ({
      ...role,
      permissions: role.permissions.map((rp) => rp.permission),
    }));

    return NextResponse.json(apiSuccess(rolesWithPermissions));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    if (auth.role !== ROLES.SUPER_ADMIN) {
      return NextResponse.json(apiError('Only SUPER_ADMIN can create roles', 'FORBIDDEN', undefined, 403), { status: 403 });
    }

    const body = await request.json();

    if (!body.name) {
      return NextResponse.json(apiError('name is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const validRoles = ['SUPER_ADMIN', 'ADMIN', 'DEVOPS', 'SUPPORT', 'VIEWER'];
    if (!validRoles.includes(body.name)) {
      return NextResponse.json(apiError(`name must be one of: ${validRoles.join(', ')}`, 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const existing = await db.role.findUnique({ where: { name: body.name } });
    if (existing) {
      return NextResponse.json(apiError('Role already exists', 'CONFLICT', undefined, 409), { status: 409 });
    }

    const role = await db.role.create({
      data: {
        name: body.name,
        description: body.description ?? undefined,
      },
    });

    // Assign permissions if provided
    if (body.permissionIds && Array.isArray(body.permissionIds)) {
      for (const permId of body.permissionIds) {
        await db.rolePermission.create({
          data: {
            roleId: role.id,
            permissionId: permId,
          },
        });
      }
    }

    const created = await db.role.findUnique({
      where: { id: role.id },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });

    return NextResponse.json(apiSuccess({
      ...created,
      permissions: created?.permissions.map((rp) => rp.permission) ?? [],
    }));
  } catch (e) {
    return handleErr(e);
  }
}
