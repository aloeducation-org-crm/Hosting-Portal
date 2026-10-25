import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getToken } from "next-auth/jwt";
import { apiSuccess, apiError } from "@/lib/response";
import { env } from "@/lib/env";

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json(
        apiError("Unauthorized", "UNAUTHORIZED", undefined, 401),
        { status: 401 }
      );
    }

    const userId = (token.userId || token.sub) as string | undefined;
    const email = token.email as string | undefined;

    const user = await db.user.findUnique({
      where: userId ? { id: userId } : { email: email! },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
        subscriptions: {
          where: { status: "active" },
          include: { plan: true },
          take: 1,
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        apiError("User not found", "NOT_FOUND", undefined, 401),
        { status: 401 }
      );
    }

    const permissions = user.role.permissions.map((rp) => rp.permission.name);
    const activePlan = user.subscriptions?.[0]?.plan?.name?.toLowerCase() || "starter";

    return NextResponse.json(
      apiSuccess({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role.name,
        isActive: user.isActive,
        emailVerified: !!user.emailVerified,
        onboardingCompleted: user.onboardingCompleted ?? false,
        onboardingStep: user.onboardingStep ?? 0,
        companyName: user.companyName,
        plan: activePlan,
        permissions,
      })
    );
  } catch (error) {
    console.error("Session error:", error);
    return NextResponse.json(
      apiError("Internal server error", "INTERNAL_ERROR", undefined, 500),
      { status: 500 }
    );
  }
}
