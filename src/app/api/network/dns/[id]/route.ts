import { db } from '@/lib/db';
import { requireSession, canAccessWebsite } from '@/lib/auth';
import { publishDnsRecord, deleteDnsGate } from '@/lib/dns-provider';
import { NextRequest, NextResponse } from 'next/server';

const VALID_TYPES = new Set(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA']);

async function getAuthorizedUser(req: NextRequest) {
  try {
    return await requireSession(req);
  } catch {
    return null;
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthorizedUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const { type, name, value, ttl, priority, isActive } = body;

    if (type !== undefined && !VALID_TYPES.has(String(type))) {
      return NextResponse.json({ error: 'Invalid DNS record type' }, { status: 400 });
    }

    const record = await db.dnsRecord.findUnique({
      where: { id },
      include: { domain: { include: { website: true } } },
    });
    if (!record) return NextResponse.json({ error: 'DNS record not found' }, { status: 404 });

    if (!canAccessWebsite(user, record.domain?.website)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // §8 publication gate — the merged result must publish (or be explicitly
    // panel-only) before the row changes, so stored rows always mean exactly
    // what the configured mode can back up.
    const pub = await publishDnsRecord({
      type: String(type ?? record.type),
      name: String(name ?? record.name),
      value: String(value ?? record.value),
      ttl: Number(ttl ?? record.ttl),
      priority:
        priority !== undefined
          ? priority !== null
            ? Number(priority)
            : record.priority ?? undefined
          : record.priority ?? undefined,
    });
    if (!pub.ok) {
      return NextResponse.json({ error: pub.note, code: pub.code ?? 'DNS_PUBLISH_FAILED' }, { status: 409 });
    }

    const updated = await db.dnsRecord.update({
      where: { id },
      data: {
        ...(type !== undefined ? { type: String(type) } : {}),
        ...(name !== undefined ? { name: String(name) } : {}),
        ...(value !== undefined ? { value: String(value) } : {}),
        ...(ttl !== undefined ? { ttl: Number(ttl) } : {}),
        ...(priority !== undefined ? { priority: priority !== null ? Number(priority) : null } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
    });
    return NextResponse.json({ ...updated, publication: pub });
  } catch (error) {
    console.error('DNS PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthorizedUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const record = await db.dnsRecord.findUnique({
      where: { id },
      include: { domain: { include: { website: true } } },
    });
    if (!record) return NextResponse.json({ error: 'DNS record not found' }, { status: 404 });

    if (!canAccessWebsite(user, record.domain?.website)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // §8 deletion gate — in an executing mode an external delete cannot be
    // performed or verified (provider record IDs are not stored), so refuse
    // instead of leaving authoritative records behind a "deleted" panel row.
    const gate = deleteDnsGate();
    if (!gate.ok) {
      return NextResponse.json({ error: gate.note, code: gate.code ?? 'DNS_PROVIDER_BLOCKED' }, { status: 409 });
    }

    await db.dnsRecord.delete({ where: { id } });
    return NextResponse.json({ success: true, publication: gate });
  } catch (error) {
    console.error('DNS DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
