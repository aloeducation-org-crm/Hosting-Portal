import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, ROLES } from '@/lib/auth';
import { db } from '@/lib/db';
import { z } from 'zod';
import { campaignDeliveryCounts } from '@/lib/messaging/control';

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
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where: any = {};
    if (auth.role !== ROLES.SUPER_ADMIN) {
      where.userId = auth.id;
    }
    if (status) {
      where.status = status;
    }

    const campaigns = await db.emailCampaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const counts = await campaignDeliveryCounts(campaigns.map(({ id }) => id));
    return NextResponse.json(apiSuccess(campaigns.map(({ sentCount: _sent, sentAt: _time, ...campaign }) => ({
      ...campaign, delivery: counts.get(campaign.id) ?? null,
    }))));
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const parsed = z.object({
      name: z.string().trim().min(1).max(160), subject: z.string().trim().min(1).max(200),
      content: z.string().max(100_000).optional(), textContent: z.string().max(50_000).optional(),
      fromName: z.string().max(120).optional(), fromAddress: z.email().optional(),
      status: z.literal('draft').optional(),
    }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw apiError('Provide a valid campaign draft', 'VALIDATION_ERROR', undefined, 400);
    const campaign = await db.emailCampaign.create({ data: { ...parsed.data, status: 'draft', userId: auth.id } });

    return NextResponse.json(apiSuccess(campaign));
  } catch (e) {
    return handleErr(e);
  }
}
