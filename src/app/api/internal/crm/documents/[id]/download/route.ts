import { NextRequest, NextResponse } from "next/server";
import { CORRELATION_HEADER, requireServiceAuth } from "@/lib/integrations/crm-service-route";
import { readDocumentForService } from "@/lib/integrations/crm-storage-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/crm/documents/[id]/download — authenticated download proxy.
 *
 * The alternative to a signed URL, for a server-side CRM caller that already
 * holds the credential and would rather stream the bytes than mint a URL.
 * Authorized by the credential's `storage:documents:download` scope plus
 * object-level tenant checks, and audited on every read.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireServiceAuth(request, "storage:documents:download");
  if (!auth.ok) return auth.response;
  const { principal, correlationId } = auth.context;

  const { id } = await params;
  const result = await readDocumentForService(principal, correlationId, id);

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
      "cache-control": "private, no-store",
      "x-content-sha256": document.sha256,
      [CORRELATION_HEADER]: correlationId,
    },
  });
}
