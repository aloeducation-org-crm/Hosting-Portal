import { z } from 'zod'
import { apiSuccess, apiError } from '@/lib/response'
import { getToken } from 'next-auth/jwt'
import { db } from '@/lib/db'

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueDate: z.string().datetime().optional(),
})

export async function GET(request: Request) {
  try {
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    const userId = (token?.id ?? token?.userId ?? token?.sub) as string | undefined
    if (!userId) return Response.json(apiError('Unauthorized', 'UNAUTHORIZED', undefined, 401), { status: 401 })
    const tasks = await db.task.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
    return Response.json(apiSuccess(tasks))
  } catch { return Response.json(apiError('Failed to load tasks', 'INTERNAL_ERROR'), { status: 500 }) }
}

export async function POST(request: Request) {
  try {
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    const userId = (token?.id ?? token?.userId ?? token?.sub) as string | undefined
    if (!userId) return Response.json(apiError('Unauthorized', 'UNAUTHORIZED', undefined, 401), { status: 401 })
    const body = await request.json()
    const result = createSchema.safeParse(body)
    if (!result.success) return Response.json(apiError('Validation failed', 'VALIDATION_ERROR', result.error.issues, 422), { status: 422 })
    const taskData: Record<string, unknown> = { ...result.data, userId }
    if (result.data.dueDate) taskData.dueDate = new Date(result.data.dueDate)
    const task = await db.task.create({ data: taskData as any })
    return Response.json(apiSuccess(task), { status: 201 })
  } catch { return Response.json(apiError('Failed to create task', 'INTERNAL_ERROR'), { status: 500 }) }
}
