import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession, canAccessWebsite } from '@/lib/auth';
import { db } from '@/lib/db';
import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';

const PUBLIC_HOSTNAME_REGEX =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/i;

function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    const [a = 0, b = 0] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    if (lower.startsWith('::ffff:')) {
      return isPrivateOrReservedIp(lower.slice(7));
    }
    return false;
  }
  return true;
}

export function isAllowedPublicSslTarget(rawDomain: string): boolean {
  const domain = rawDomain.trim().toLowerCase();
  if (!PUBLIC_HOSTNAME_REGEX.test(domain)) return false;
  if (net.isIP(domain) !== 0) return false;
  if (
    domain === 'localhost' ||
    domain.endsWith('.localhost') ||
    domain.endsWith('.local') ||
    domain.endsWith('.internal') ||
    domain.endsWith('.arpa')
  ) {
    return false;
  }
  return true;
}

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const { searchParams } = new URL(request.url);
    const domain = (searchParams.get('domain') ?? '').trim().toLowerCase();

    if (!domain) {
      throw apiError('domain query parameter is required', 'VALIDATION_ERROR', undefined, 400);
    }

    if (!isAllowedPublicSslTarget(domain)) {
      throw apiError('A valid public DNS hostname is required', 'VALIDATION_ERROR', undefined, 400);
    }

    // Check local DB record (only expose local DB metadata if owned by caller or admin)
    const dbDomain = await db.domain.findUnique({
      where: { domain },
      include: { certificate: true, website: true },
    });
    const visibleDomain = dbDomain && canAccessWebsite(user, dbDomain.website) ? dbDomain : null;

    const autoRenew = visibleDomain?.certificate?.autoRenew ?? false;

    const liveInfo = await checkLiveSsl(domain);

    const result = {
      domain,
      dbStatus: visibleDomain?.sslStatus ?? 'NONE',
      dbExpiry: visibleDomain?.certificateExpiry ?? null,
      ...liveInfo,
      autoRenew,
    };

    return NextResponse.json(apiSuccess(result));
  } catch (e) {
    return handleErr(e);
  }
}

interface LiveSslResult {
  valid: boolean;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining?: number;
  error?: string;
}

interface PeerCertificate {
  valid_to?: string;
  valid_from?: string;
  issuer?: Record<string, string>;
  subject?: Record<string, string>;
}

async function checkLiveSsl(hostname: string): Promise<LiveSslResult> {
  let publicAddress: string;
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.length === 0 || records.some((r) => isPrivateOrReservedIp(r.address))) {
      return { valid: false, error: 'Target hostname resolves to a non-public address' };
    }
    publicAddress = records[0]!.address;
  } catch {
    return { valid: false, error: 'DNS resolution failed for hostname' };
  }

  return new Promise((resolve) => {
    const req = https.request(
      {
        host: publicAddress,
        servername: hostname,
        headers: { Host: hostname },
        port: 443,
        method: 'HEAD',
        rejectUnauthorized: true,
        timeout: 10_000,
        agent: false,
      },
      (res: IncomingMessage) => {
        const tlsSocket = res.socket as unknown as { getPeerCertificate?: () => PeerCertificate };
        const cert = tlsSocket?.getPeerCertificate?.();

        if (!cert || !cert.valid_to) {
          resolve({
            valid: false,
            error: 'No certificate presented by server',
          });
          res.destroy();
          return;
        }

        const validTo = new Date(cert.valid_to);
        const now = new Date();
        const diffMs = validTo.getTime() - now.getTime();
        const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        res.destroy();

        resolve({
          valid: daysRemaining > 0,
          issuer: cert.issuer?.O || cert.issuer?.CN || 'Unknown',
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          daysRemaining: Math.max(0, daysRemaining),
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ valid: false, error: 'Connection timed out' });
    });

    req.on('error', () => {
      resolve({
        valid: false,
        error: 'TLS handshake or connection failed',
      });
    });

    req.end();
  });
}
