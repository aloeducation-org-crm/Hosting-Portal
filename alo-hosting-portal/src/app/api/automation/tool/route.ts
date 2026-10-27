import { createHash, timingSafeEqual } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { NextRequest, NextResponse } from 'next/server';

const execFileAsync = promisify(execFile);

const UNSAFE_SECRETS = new Set([
  '',
  'change-me-internal-secret',
  'alo-internal-secret-change-me',
  'replace-with-openssl-rand-hex-32',
]);

function isAuthorizedInternalRequest(req: NextRequest): boolean {
  const configured = (process.env.INTERNAL_SECRET ?? '').trim();
  if (!configured || UNSAFE_SECRETS.has(configured.toLowerCase())) {
    return false;
  }
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;
  const provided = header.slice(7).trim();
  if (!provided) return false;
  const left = createHash('sha256').update(provided, 'utf8').digest();
  const right = createHash('sha256').update(configured, 'utf8').digest();
  return timingSafeEqual(left, right);
}

const ALLOWED_COMMANDS: Record<string, { cmd: string; args: string[]; requiresApproval: boolean }> = {
  'restart-app': {
    cmd: 'pm2',
    args: ['reload', 'alo-hosting-portal', '--update-env'],
    requiresApproval: true,
  },
  'system-status': {
    cmd: 'pm2',
    args: ['jlist'],
    requiresApproval: false,
  },
};

export async function POST(req: NextRequest) {
  if (!isAuthorizedInternalRequest(req)) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action, approved } = body as { action?: string; approved?: boolean };

    const spec = action ? ALLOWED_COMMANDS[action] : undefined;
    if (!spec) {
      return NextResponse.json({ success: false, error: 'Disallowed command action' }, { status: 403 });
    }

    if (spec.requiresApproval && approved !== true) {
      return NextResponse.json(
        { success: false, requiresApproval: true, message: `Action "${action}" requires explicit approval` },
        { status: 409 },
      );
    }

    const { stdout, stderr } = await execFileAsync(spec.cmd, spec.args, {
      timeout: 30_000,
      maxBuffer: 512 * 1024,
    });

    return NextResponse.json({
      success: true,
      action,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Command execution failed' }, { status: 500 });
  }
}
