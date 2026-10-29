import { NextRequest } from "next/server";
import { serviceResponse, requireServiceAuth } from "@/lib/integrations/crm-service-route";
import { readDocumentForService } from "@/lib/integrations/crm-storage-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/crm/documents/[id] — document metadata for a service caller.
 *
 * Object-level authorization: a document outside the credential's organization
 * returns 404 rather than 403, so a caller cannot enumerate which document ids
 * exist in another tenant. The response never includes `storagePath`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireServiceAuth(request, "storage:documents:read");
  if (!auth.ok) return auth.response;
  const { principal, correlationId } = auth.context;

  const { id } = await params;
  // Read the same document the download path would, but return metadata only —
  // bytes are served by /content so a metadata poll never streams a file.
  const result = await readDocumentForService(principal, correlationId, id);
  if (!result.ok) return serviceResponse(result, correlationId);

  return serviceResponse({ ok: true, status: 200, body: { document: result.body.document } }, correlationId);
}
