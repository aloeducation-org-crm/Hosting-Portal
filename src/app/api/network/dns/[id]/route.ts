import { db } from '@/lib/db';
import { requireSession, canAccessWebsite } from '@/lib/auth';
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
    return NextResponse.json(updated);
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

    await db.dnsRecord.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DNS DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
