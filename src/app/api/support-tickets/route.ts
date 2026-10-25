import { z } from 'zod'
import { apiSuccess, apiError } from '@/lib/response'
import { getToken } from 'next-auth/jwt'
import { db } from '@/lib/db'

const createSchema = z.object({ subject: z.string().min(1), description: z.string().min(1), priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium') })

export async function GET(request: Request) {
  try {
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token?.id) return Response.json(apiError('Unauthorized', 'UNAUTHORIZED', undefined, 401), { status: 401 })
    const tickets = await db.supportTicket.findMany({ where: { userId: token.id as string }, orderBy: { createdAt: 'desc' } })
    return Response.json(apiSuccess(tickets))
  } catch { return Response.json(apiError('Failed to load tickets', 'INTERNAL_ERROR'), { status: 500 }) }
}

export async function POST(request: Request) {
  try {
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token?.id) return Response.json(apiError('Unauthorized', 'UNAUTHORIZED', undefined, 401), { status: 401 })
    const body = await request.json()
    const result = createSchema.safeParse(body)
    if (!result.success) return Response.json(apiError('Validation failed', 'VALIDATION_ERROR', result.error.issues, 422), { status: 422 })
    const ticket = await db.supportTicket.create({ data: { ...result.data, userId: token.id as string } })
    return Response.json(apiSuccess(ticket), { status: 201 })
  } catch { return Response.json(apiError('Failed to create ticket', 'INTERNAL_ERROR'), { status: 500 }) }
}
