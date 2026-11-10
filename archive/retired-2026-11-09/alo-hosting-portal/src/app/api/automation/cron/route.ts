import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

function verifyCronBearer(req: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (!secret || secret.toLowerCase().startsWith('alo-cron-secret') || secret.toLowerCase().startsWith('replace-with-')) {
    return false;
  }
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const supplied = authHeader.slice(7).trim();
  if (!supplied) return false;
  const left = createHash('sha256').update(supplied, 'utf8').digest();
  const right = createHash('sha256').update(secret, 'utf8').digest();
  return timingSafeEqual(left, right);
}

export async function GET(req: NextRequest) {
  if (!verifyCronBearer(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized cron trigger' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    message: 'Cron trigger authenticated; delegate scheduled tasks via /api/operations/worker',
    timestamp: new Date().toISOString(),
  });
}
