import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { cloudflareRegistrar } from '@/lib/registrar/cloudflare';

/**
 * Authenticated domain availability lookup.
 *
 * When the Cloudflare Registrar is configured (CLOUDFLARE_API_TOKEN +
 * CLOUDFLARE_ACCOUNT_ID, with the token carrying Account:Registrar:Edit),
 * the lookup goes to Cloudflare's Registrar availability endpoint and
 * returns the live one-year price for the queried TLD.
 *
 * When it is NOT configured, the response is still honest: a 501 with
 * `code: REGISTRAR_NOT_CONFIGURED` — exactly as before this route was
 * wired to a real provider — so the storefront UI shows "check at
 * checkout" rather than fabricating an availability verdict or a price.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const domain = new URL(request.url).searchParams.get('q')?.trim().toLowerCase();
    if (!domain) {
      return NextResponse.json(
        { success: false, error: 'Domain query parameter "q" is required' },
        { status: 400 },
      );
    }
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/.test(domain)) {
      return NextResponse.json(
        { success: false, error: 'Invalid domain name' },
        { status: 400 },
      );
    }

    const cfg = cloudflareRegistrar.registrarConfig();
    if (!cfg.configured) {
      return NextResponse.json({
        success: false,
        code: 'REGISTRAR_NOT_CONFIGURED',
        availability: 'UNKNOWN',
        missing: cfg.missing,
        error: 'Registrar availability lookup is not configured on this server',
      }, { status: 501 });
    }

    const result = await cloudflareRegistrar.checkAvailability(domain);
    return NextResponse.json({
      success: true,
      domain: result.domain,
      available: result.available,
      premium: result.premium,
      price: result.price,
      renewalPrice: result.renewalPrice,
      reason: result.reason ?? null,
      provider: 'cloudflare-registrar',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 },
    );
  }
}
