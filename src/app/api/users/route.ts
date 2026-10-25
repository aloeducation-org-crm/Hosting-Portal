import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    if (!isAdminRole(auth.role)) {
      return NextResponse.json(
        apiError("Only administrators can list users", "FORBIDDEN", undefined, 403),
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);
    const search = searchParams.get("search");
    const roleFilter = searchParams.get("role");

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { email: { contains: search } },
        { name: { contains: search } },
      ];
    }
    if (roleFilter && roleFilter !== "ALL") {
      where.role = { name: roleFilter };
    }

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        include: {
          role: true,
          _count: {
            select: { websites: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.user.count({ where }),
    ]);

    const safeUsers = users.map(({ passwordHash: _, ...user }) => user);

    return NextResponse.json(
      apiSuccess({
        users: safeUsers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);

    if (!isAdminRole(auth.role)) {
      return NextResponse.json(
        apiError("Only administrators can create users", "FORBIDDEN", undefined, 403),
        { status: 403 }
      );
    }

    const body = await request.json();

    if (!body.email || !body.password || (!body.roleId && !body.role)) {
      return NextResponse.json(
        apiError(
          "email, password, and roleId (or role) are required",
          "VALIDATION_ERROR",
          undefined,
          400
        ),
        { status: 400 }
      );
    }

    const normalizedEmail = String(body.email).toLowerCase().trim();
    const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return NextResponse.json(
        apiError("User with this email already exists", "CONFLICT", undefined, 409),
        { status: 409 }
      );
    }

    const role = body.roleId
      ? await db.role.findUnique({ where: { id: body.roleId } })
      : await db.role.findUnique({ where: { name: body.role } });

    if (!role) {
      return NextResponse.json(
        apiError("Role not found", "NOT_FOUND", undefined, 404),
        { status: 404 }
      );
    }

    const passwordHash = await hashPassword(body.password);

    const user = await db.user.create({
      data: {
        email: normalizedEmail,
        name: body.name ?? undefined,
        companyName: body.companyName ?? undefined,
        passwordHash,
        roleId: role.id,
        isActive: body.isActive ?? true,
        emailVerified: new Date(),
        onboardingCompleted: true,
      },
      include: { role: true },
    });

    await db.auditLog.create({
      data: {
        actorUserId: auth.id,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: "USER_CREATE",
        resourceType: "User",
        resourceId: user.id,
        result: "SUCCESS",
      },
    });

    const { passwordHash: _, ...safeUser } = user;

    return NextResponse.json(apiSuccess(safeUser, "User created", 201), { status: 201 });
  } catch (e) {
    return handleErr(e);
  }
}
