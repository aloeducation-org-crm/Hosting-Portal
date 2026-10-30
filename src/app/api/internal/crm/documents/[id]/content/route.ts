import { NextRequest, NextResponse } from "next/server";
import { CORRELATION_HEADER } from "@/lib/integrations/crm-service-route";
import { resolveSignedDownload } from "@/lib/integrations/crm-storage-router";
import { resolveCorrelationId } from "@/lib/integrations/service-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/crm/documents/[id]/content — resolve a SIGNED download URL.
 *
 * Authorized by the HMAC signature in the query string, not by a bearer token:
 * this is the URL a counselor's browser follows, and a browser cannot carry the
 * CRM's service credential. The signature binds document + tenant + issuing
 * credential + expiry, so it cannot be retargeted at another document or tenant.
 *
 * Verification is not the whole story — after the signature checks out, the
 * document's organization is re-validated against the database and the issuing
 * credential is re-checked for revocation, so revoking a credential also stops
 * its outstanding URLs.
 *
 * An expired URL returns 410 Gone, which is distinct from 403 so the CRM can tell
 * "re-request a fresh URL" apart from "you were never allowed this".
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const correlationId = resolveCorrelationId(request.headers.get("x-request-id"));
  const search = request.nextUrl.searchParams;

  const result = await resolveSignedDownload(correlationId, {
    documentId: id,
    organizationId: search.get("org"),
    credentialId: search.get("cred"),
    expiresAt: search.get("exp"),
    signature: search.get("sig"),
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        status: result.status,
        success: false,
        message: result.message,
        data: null,
        error: { code: result.code },
        requestId: correlationId,
      },
      { status: result.status, headers: { [CORRELATION_HEADER]: correlationId, "cache-control": "no-store" } },
    );
  }

  const { bytes, document } = result.body;
  const asciiName = document.filename.replace(/[^\x20-\x7e]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": document.contentType,
      "content-length": String(bytes.length),
      "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
      // Never cache a private document, and never let an intermediary store it.
      "cache-control": "private, no-store",
      "x-content-sha256": document.sha256,
      [CORRELATION_HEADER]: correlationId,
    },
  });
}
