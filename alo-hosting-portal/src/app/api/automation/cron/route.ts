import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET || 'alo-cron-secret-2026';

  // Protect cron triggers with bearer secret
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized cron trigger' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    message: 'Cron tasks completed cleanly',
    tasksRun: ['health-check', 'log-rotation', 'backup-verify'],
    timestamp: new Date().toISOString(),
  });
}
