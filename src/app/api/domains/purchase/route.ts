import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { cloudflareRegistrar } from '@/lib/registrar/cloudflare';
import { tldPrice } from '@/lib/marketing/hosting-catalog';

const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

function resolveDomainPriceCents(domain: string, years: number): number | null {
  const parts = domain.split('.');
  if (parts.length < 2) return null;
  const twoPart = parts.length >= 3 ? `.${parts.slice(-2).join('.')}` : '';
  const onePart = `.${parts[parts.length - 1]}`;
  const entry = (twoPart ? tldPrice(twoPart) : undefined) ?? tldPrice(onePart);
  if (!entry) return null;
  return Math.round(entry.register * 100 * years);
}

/**
 * Operator-authorized domain purchase flow.
 *
 * Security policy: because upstream Cloudflare Registrar orders immediately
 * charge the platform registrar account, this endpoint is strictly restricted
 * to administrators (`ADMIN` / `SUPER_ADMIN`) and requires explicit
 * `confirmRegistrarSpend: true` acknowledgment before submitting live orders.
 * Self-service customer purchases must go through a verified paid checkout
 * webhook rather than calling the registrar directly.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const body = await request.json();
    const domain = (body.domain ?? '').trim().toLowerCase();
    const years = Math.min(Math.max(Math.floor(Number(body.years ?? 1)) || 1, 1), 10);

    if (!domain) {
      return NextResponse.json(apiError('domain is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    if (!DOMAIN_REGEX.test(domain)) {
      return NextResponse.json(apiError('Invalid domain format', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    if (body.confirmRegistrarSpend !== true) {
      return NextResponse.json(
        apiError(
          'Explicit operator confirmation (confirmRegistrarSpend: true) is required before creating a registrar order',
          'PAYMENT_CONFIRMATION_REQUIRED',
          undefined,
          402,
        ),
        { status: 402 },
      );
    }

    const existingDomain = await db.domain.findUnique({
      where: { domain },
    });

    if (existingDomain) {
      return NextResponse.json(apiError('Domain is already registered in the system', 'CONFLICT', undefined, 409), { status: 409 });
    }

    const catalogPriceCents = resolveDomainPriceCents(domain, years);
    if (catalogPriceCents === null) {
      return NextResponse.json(
        apiError('Unsupported TLD for direct registrar ordering', 'UNSUPPORTED_TLD', undefined, 400),
        { status: 400 },
      );
    }

    const orderNumber = `ORD-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;

    const order = await db.order.create({
      data: {
        orderNumber,
        userId: auth.id,
        totalCents: catalogPriceCents,
        currency: 'USD',
        status: 'processing',
        items: {
          create: {
            description: `Domain registration: ${domain} (${years} yr)`,
            type: 'domain',
            quantity: years,
            unitPriceCents: Math.round(catalogPriceCents / years),
            totalCents: catalogPriceCents,
            metadata: { domain, years, authorizedBy: auth.id },
          },
        },
      },
      include: { items: true },
    });

    const cfg = cloudflareRegistrar.registrarConfig();
    if (!cfg.configured) {
      await createAuditLog({
        actorId: auth.id,
        actorEmail: auth.email,
        actorRole: auth.role,
        action: 'DOMAIN_PURCHASE_RECORDED_UNCONFIGURED',
        resourceType: 'Order',
        resourceId: order.id,
        domain,
        result: 'SUCCESS',
        metadata: { orderNumber, totalCents: catalogPriceCents, years },
      });
      return NextResponse.json(apiSuccess({
        order,
        domain,
        registrar: { submitted: false, configured: false, missing: cfg.missing },
        message: `Domain purchase recorded as order ${order.orderNumber}, but the registrar is not configured. No domain was registered with an upstream provider.`,
      }));
    }

    const contact = body.contact ?? {
      first_name: body.first_name ?? 'ALO',
      last_name: body.last_name ?? 'Labs',
      email: body.email ?? auth.email ?? 'admin@alolabs.net',
      phone: body.phone ?? '+1.0000000000',
      address: body.address ?? 'Pending operator update',
      city: body.city ?? 'Pending',
      state: body.state ?? 'NA',
      zip: body.zip ?? '00000',
      country: body.country ?? 'US',
    };

    const result = await cloudflareRegistrar.purchaseDomain({
      domain,
      years,
      auto_renew: Boolean(body.auto_renew ?? true),
      whois_privacy: Boolean(body.whois_privacy ?? true),
      contact,
    });

    await db.order.update({
      where: { id: order.id },
      data: {
        status: result.submitted && result.status === 'completed' ? 'completed' : 'processing',
        items: {
          updateMany: {
            where: { orderId: order.id },
            data: {
              metadata: {
                domain,
                years,
                authorizedBy: auth.id,
                registrarOrderId: result.order_id || null,
                registrarStatus: result.status,
                registrarSubmitted: result.submitted,
                registrarError: result.error ?? null,
              },
            },
          },
        },
      },
    });

    await createAuditLog({
      actorId: auth.id,
      actorEmail: auth.email,
      actorRole: auth.role,
      action: result.submitted ? 'DOMAIN_PURCHASE_SUBMITTED' : 'DOMAIN_PURCHASE_FAILED',
      resourceType: 'Order',
      resourceId: order.id,
      domain,
      result: result.submitted ? 'SUCCESS' : 'FAILURE',
      metadata: {
        orderNumber,
        registrarOrderId: result.order_id || null,
        registrarStatus: result.status,
        totalCents: catalogPriceCents,
      },
    });

    if (!result.submitted) {
      return NextResponse.json(apiSuccess({
        order: { ...order, status: 'processing' },
        domain,
        registrar: { submitted: false, configured: true, error: result.error },
        message: `Domain purchase recorded as order ${order.orderNumber}, but the registrar rejected the submission: ${result.error}. The order remains in 'processing' for follow-up.`,
      }));
    }

    return NextResponse.json(apiSuccess({
      order: { ...order, status: result.status === 'completed' ? 'completed' : 'processing' },
      domain,
      registrar: {
        submitted: true,
        configured: true,
        orderId: result.order_id,
        status: result.status,
        total: result.total,
        currency: result.currency,
      },
      message: `Domain purchase submitted to Cloudflare Registrar as order ${result.order_id}. Registration is ${result.status}.`,
    }));
  } catch (e) {
    return handleErr(e);
  }
}
