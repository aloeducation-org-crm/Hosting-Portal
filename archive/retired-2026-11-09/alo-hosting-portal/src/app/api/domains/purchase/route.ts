import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';

const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();
    const domain = (body.domain ?? '').trim().toLowerCase();

    if (!domain) {
      return NextResponse.json(apiError('domain is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    if (!DOMAIN_REGEX.test(domain)) {
      return NextResponse.json(apiError('Invalid domain format', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    // Check if domain already exists in our database
    const existingDomain = await db.domain.findUnique({
      where: { domain },
    });

    if (existingDomain) {
      return NextResponse.json(apiError('Domain is already registered in the system', 'CONFLICT', undefined, 409), { status: 409 });
    }

    const priceCents = 1299; // $12.99
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Create order with domain item
    const order = await db.order.create({
      data: {
        orderNumber,
        userId: auth.id,
        totalCents: priceCents,
        currency: 'USD',
        status: 'processing',
        items: {
          create: {
            description: `Domain registration: ${domain}`,
            type: 'domain',
            quantity: 1,
            unitPriceCents: priceCents,
            totalCents: priceCents,
            metadata: { domain },
          },
        },
      },
      include: { items: true },
    });

    return NextResponse.json(apiSuccess({
      order,
      domain,
      message: `Domain purchase initiated for "${domain}"`,
    }));
  } catch (e) {
    return handleErr(e);
  }
}
