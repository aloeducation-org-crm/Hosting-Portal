import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const domain = new URL(request.url).searchParams.get('q')?.trim().toLowerCase();
    if (!domain) {
      return NextResponse.json({ success: false, error: 'Domain query parameter "q" is required' }, { status: 400 });
    }
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/.test(domain)) {
      return NextResponse.json({ success: false, error: 'Invalid domain name' }, { status: 400 });
    }
    // DNS absence is not evidence of registrar availability. Do not quote a fake price
    // or claim a name is free without a configured registrar API.
    return NextResponse.json({
      success: false,
      code: 'REGISTRAR_NOT_CONFIGURED',
      availability: 'UNKNOWN',
      error: 'Registrar availability lookup is not configured on this server',
    }, { status: 501 });
  } catch {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }
}
