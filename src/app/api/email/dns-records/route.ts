import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { readFileSync, existsSync } from 'fs';

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

    if (!/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))+$/.test(domain)) {
      return NextResponse.json(apiError('Invalid domain name', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    // Only report values backed by current server configuration.
    const server = await db.server.findFirst();
    const serverIp = server?.ip;
    if (!serverIp) {
      return NextResponse.json(apiError('Server IP is not configured; SPF data is unavailable', 'NOT_CONFIGURED', undefined, 503), { status: 503 });
    }

    // SPF Record
    const spf = `v=spf1 ip4:${serverIp} -all`;

    // DKIM Record - try to read existing key or generate placeholder
    const dkimPath = `/etc/opendkim/keys/${domain}/alo.public`;
    let dkimPublicKey = '';
    if (existsSync(dkimPath)) {
      try {
        dkimPublicKey = readFileSync(dkimPath, 'utf-8').trim();
      } catch {
        dkimPublicKey = '';
      }
    }

    if (!dkimPublicKey) {
      return NextResponse.json(apiError('DKIM key is not installed for this domain', 'NOT_CONFIGURED', undefined, 503), { status: 503 });
    }

    const dkim = {
      selector: 'alo',
      name: `alo._domainkey.${domain}`,
      type: 'TXT',
      record: `v=DKIM1; k=rsa; p=${dkimPublicKey}`,
    };

    // DMARC Record
    const dmarc = {
      name: `_dmarc.${domain}`,
      type: 'TXT',
      record: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`,
    };

    // MX Record recommendation
    const mx = {
      name: domain,
      type: 'MX',
      value: `mail.${domain}`,
      priority: 10,
      ttl: 3600,
    };

    return NextResponse.json(
      apiSuccess({
        domain,
        spf: {
          name: domain,
          type: 'TXT',
          record: spf,
          ttl: 3600,
        },
        dkim,
        dmarc,
        mx,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
