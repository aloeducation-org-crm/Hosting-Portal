import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { promisify } from 'util';
import dns from 'dns';

const resolve4 = promisify(dns.resolve4);
const resolveCname = promisify(dns.resolveCname);

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') ?? '';

    if (!q) {
      return NextResponse.json(apiError('Domain query parameter "q" is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    const domain = q.trim().toLowerCase();

    // Check if domain already exists in our database
    const existingDomain = await db.domain.findUnique({
      where: { domain },
    });

    if (existingDomain) {
      return NextResponse.json(apiSuccess({
        available: false,
        price: 0,
        domain,
        reason: 'already_registered',
      }));
    }

    // Check DNS to see if domain has active records
    let hasDnsRecords = false;
    try {
      await resolve4(domain);
      hasDnsRecords = true;
    } catch {
      // No A record, check CNAME
      try {
        await resolveCname(domain);
        hasDnsRecords = true;
      } catch {
        // No DNS records found - domain likely available
      }
    }

    if (hasDnsRecords) {
      return NextResponse.json(apiSuccess({
        available: false,
        price: 0,
        domain,
        reason: 'has_dns_records',
      }));
    }

    return NextResponse.json(apiSuccess({
      available: true,
      price: 12.99,
      domain,
    }));
  } catch (e) {
    return handleErr(e);
  }
}
