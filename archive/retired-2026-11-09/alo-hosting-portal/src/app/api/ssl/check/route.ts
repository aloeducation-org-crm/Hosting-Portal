import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import https from 'https';
import type { IncomingMessage } from 'http';

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
    const domain = searchParams.get('domain');

    if (!domain) {
      throw apiError('domain query parameter is required', 'VALIDATION_ERROR', undefined, 400);
    }

    // Check local DB record
    const dbDomain = await db.domain.findUnique({
      where: { domain },
      include: { certificate: true },
    });

    const autoRenew = dbDomain?.certificate?.autoRenew ?? false;

    // Attempt live SSL check
    const liveInfo = await checkLiveSsl(domain);

    const result = {
      domain,
      dbStatus: dbDomain?.sslStatus ?? 'NONE',
      dbExpiry: dbDomain?.certificateExpiry ?? null,
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

function checkLiveSsl(hostname: string): Promise<LiveSslResult> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname,
        port: 443,
        method: 'GET',
        rejectUnauthorized: false,
        timeout: 10_000,
        agent: false,
      },
      (res: IncomingMessage) => {
        // Type assertion for TLS socket with getPeerCertificate
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

    req.on('error', (err) => {
      resolve({
        valid: false,
        error: `Connection failed: ${err.message}`,
      });
    });

    req.end();
  });
}
