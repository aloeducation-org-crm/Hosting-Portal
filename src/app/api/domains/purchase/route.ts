import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { cloudflareRegistrar } from '@/lib/registrar/cloudflare';

const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

/**
 * Domain purchase flow.
 *
 * 1. Validate the domain and session.
 * 2. Reject duplicates already tracked in this panel's database.
 * 3. Create an Order row with the (hard-coded catalogue) price, so the
 *    customer's intent is durable even if the registrar call below fails.
 * 4. If the Cloudflare Registrar is configured, submit the real order
 *    through src/lib/registrar/cloudflare.ts and store the registrar's
 *    order id on the Order row. If the registrar is NOT configured, the
 *    Order is left in `processing` and the response tells the caller so.
 *
 * We never claim a domain is registered when the registrar rejected the
 * order: `submitted=true` is the only signal that the order reached the
 * registrar. Anything else leaves the Order row in `processing` for a
 * human to follow up on.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession(request);
    const body = await request.json();
    const domain = (body.domain ?? '').trim().toLowerCase();

    if (!domain) {
      return NextResponse.json(apiError('domain is required', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    if (!DOMAIN_REGEX.test(domain)) {
      return NextResponse.json(apiError('Invalid domain format', 'VALIDATION_ERROR', undefined, 400), { status: 400 });
    }

    // Check if domain already exists in our database
    const existingDomain = await db.domain.findUnique({
      where: { domain },
    });

    if (existingDomain) {
      return NextResponse.json(apiError('Domain is already registered in the system', 'CONFLICT', undefined, 409), { status: 409 });
    }

    const priceCents = 1299; // $12.99 — catalogue price; the registrar may quote differently at settle time.
    const orderNumber = `ORD-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;

    // Create order with domain item (always — durable record of intent)
    const order = await db.order.create({
      data: {
        orderNumber,
        userId: auth.id,
        totalCents: priceCents,
        currency: 'USD',
        status: 'processing',
        items: {
          create: {
            description: `Domain registration: ${domain}`,
            type: 'domain',
            quantity: 1,
            unitPriceCents: priceCents,
            totalCents: priceCents,
            metadata: { domain },
          },
        },
      },
      include: { items: true },
    });

    // Try the real registrar. If it is not configured, the Order stays
    // `processing` and the caller is told plainly — no fake success.
    const cfg = cloudflareRegistrar.registrarConfig();
    if (!cfg.configured) {
      return NextResponse.json(apiSuccess({
        order,
        domain,
        registrar: { submitted: false, configured: false, missing: cfg.missing },
        message: `Domain purchase recorded as order ${order.orderNumber}, but the registrar is not configured. No domain was registered with an upstream provider.`,
      }));
    }

    // Optional contact payload from the request body; otherwise we use a
    // minimal placeholder and the operator must update it before the order
    // is settled. Real registrar orders require a valid registrant contact.
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
      years: Number(body.years ?? 1),
      auto_renew: Boolean(body.auto_renew ?? true),
      whois_privacy: Boolean(body.whois_privacy ?? true),
      contact,
    });

    // Persist the registrar's order id + status onto the Order row so a
    // later webhook or human follow-up can reconcile them.
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
