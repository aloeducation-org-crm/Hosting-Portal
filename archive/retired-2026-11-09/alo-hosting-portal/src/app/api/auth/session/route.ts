import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getToken } from 'next-auth/jwt'
import { apiSuccess, apiError } from '@/lib/response'

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    if (!token) {
      return NextResponse.json(apiError('Unauthorized', 'UNAUTHORIZED', undefined, 401), { status: 401 })
    }

    const user = await db.user.findUnique({
      where: { id: token.sub as string },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    })

    if (!user) {
      return NextResponse.json(apiError('User not found', 'NOT_FOUND', undefined, 401), { status: 401 })
    }

    const permissions = user.role.permissions.map(rp => rp.permission.name)

    return NextResponse.json(apiSuccess({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role.name,
      isActive: user.isActive,
      permissions,
    }))
  } catch (error) {
    console.error('Session error:', error)
    return NextResponse.json(apiError('Internal server error', 'INTERNAL_ERROR', undefined, 500), { status: 500 })
  }
}
