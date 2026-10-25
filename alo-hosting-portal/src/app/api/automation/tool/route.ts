import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Whitelisted non-destructive and approved actions only
const ALLOWED_COMMANDS: Record<string, string> = {
  'restart-app': 'pm2 restart alo-hosting --update-env',
  'restart-desktop': 'pm2 restart alo-desktop',
  'run-backup': '/home/alamin/scripts/alo-backup.sh',
  'system-status': 'pm2 jlist',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, approved } = body;

    if (!ALLOWED_COMMANDS[action]) {
      return NextResponse.json({ success: false, error: 'Unauthorized command execution attempt' }, { status: 403 });
    }

    // Require explicit approval flag for mutating actions
    if ((action === 'restart-app' || action === 'run-backup') && !approved) {
      return NextResponse.json({
        success: false,
        requiresApproval: true,
        message: `Action '${action}' requires explicit confirmation.`,
      }, { status: 400 });
    }

    const command = ALLOWED_COMMANDS[action];
    const { stdout, stderr } = await execAsync(command, { timeout: 15000 });

    return NextResponse.json({
      success: true,
      action,
      output: stdout || stderr,
      executedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
