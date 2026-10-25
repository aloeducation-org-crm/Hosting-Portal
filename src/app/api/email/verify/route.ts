import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import dns from 'dns/promises';
import { db } from '@/lib/db';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    await requireSession(request);
    const body = await request.json();
    const { domain } = body as { domain: string };

    if (!domain) {
      throw apiError('domain is required', 'VALIDATION_ERROR', undefined, 400);
    }

    // Get server IP for expected SPF
    const server = await db.server.findFirst();
    const serverIp = server?.ip ?? '';
    const expectedSpf = `v=spf1 ip4:${serverIp} -all`;

    // Check SPF: TXT record at domain
    let spfValid = false;
    let spfRecord = '';
    try {
      const spfRecords = await dns.resolveTxt(domain);
      for (const records of spfRecords) {
        for (const rec of records) {
          if (rec.startsWith('v=spf1')) {
            spfRecord = rec;
            spfValid = true;
            break;
          }
        }
        if (spfValid) break;
      }
    } catch {
      spfRecord = '';
      spfValid = false;
    }

    // Check DKIM: TXT record at alo._domainkey.domain
    let dkimValid = false;
    let dkimRecord = '';
    const dkimDomain = `alo._domainkey.${domain}`;
    try {
      const dkimRecords = await dns.resolveTxt(dkimDomain);
      for (const records of dkimRecords) {
        for (const rec of records) {
          if (rec.startsWith('v=DKIM1')) {
            dkimRecord = rec;
            dkimValid = true;
            break;
          }
        }
        if (dkimValid) break;
      }
    } catch {
      dkimRecord = '';
      dkimValid = false;
    }

    // Check DMARC: TXT record at _dmarc.domain
    let dmarcValid = false;
    let dmarcRecord = '';
    const dmarcDomain = `_dmarc.${domain}`;
    try {
      const dmarcRecords = await dns.resolveTxt(dmarcDomain);
      for (const records of dmarcRecords) {
        for (const rec of records) {
          if (rec.startsWith('v=DMARC1')) {
            dmarcRecord = rec;
            dmarcValid = true;
            break;
          }
        }
        if (dmarcValid) break;
      }
    } catch {
      dmarcRecord = '';
      dmarcValid = false;
    }

    return NextResponse.json(
      apiSuccess({
        domain,
        spf: {
          valid: spfValid,
          record: spfRecord || null,
          expected: expectedSpf,
        },
        dkim: {
          valid: dkimValid,
          record: dkimRecord || null,
          expected: `v=DKIM1; k=rsa; p=...`,
        },
        dmarc: {
          valid: dmarcValid,
          record: dmarcRecord || null,
          expected: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`,
        },
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}
