import { z } from 'zod'
import { apiSuccess, apiError } from '@/lib/response'
import { getToken } from 'next-auth/jwt'
import { db } from '@/lib/db'

const createSchema = z.object({ name: z.string().min(1), description: z.string().optional() })

export async function GET(request: Request) {
  try {
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token?.id) return Response.json(apiError('Unauthorized', 'UNAUTHORIZED', undefined, 401), { status: 401 })
    const projects = await db.project.findMany({ where: { userId: token.id as string }, orderBy: { createdAt: 'desc' } })
    return Response.json(apiSuccess(projects))
  } catch { return Response.json(apiError('Failed to load projects', 'INTERNAL_ERROR'), { status: 500 }) }
}

export async function POST(request: Request) {
  try {
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token?.id) return Response.json(apiError('Unauthorized', 'UNAUTHORIZED', undefined, 401), { status: 401 })
    const body = await request.json()
    const result = createSchema.safeParse(body)
    if (!result.success) return Response.json(apiError('Validation failed', 'VALIDATION_ERROR', result.error.issues, 422), { status: 422 })
    const project = await db.project.create({ data: { ...result.data, userId: token.id as string } })
    return Response.json(apiSuccess(project), { status: 201 })
  } catch { return Response.json(apiError('Failed to create project', 'INTERNAL_ERROR'), { status: 500 }) }
}
