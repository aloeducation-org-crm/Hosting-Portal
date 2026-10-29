import { NextRequest } from "next/server";
import { serviceResponse, requireServiceAuth } from "@/lib/integrations/crm-service-route";
import { issueDownloadUrlForService } from "@/lib/integrations/crm-storage-router";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/internal/crm/documents/[id]/download-url — mint a short-lived signed
 * download URL.
 *
 * The preferred way for the CRM to fetch document bytes: the URL expires in
 * minutes, is bound to the document, the tenant and the issuing credential, and
 * lets the CRM hand a counselor's browser a direct download WITHOUT the CRM ever
 * proxying the file or learning where it lives on disk.
 *
 * Returns 503 rather than an unsigned URL when the signing key is missing or too
 * short — a misconfigured server must not quietly degrade into handing out
 * permanent public links to private documents.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireServiceAuth(request, "storage:documents:download");
  if (!auth.ok) return auth.response;
  const { principal, correlationId } = auth.context;

  const { id } = await params;
  const baseUrl = request.headers.get("origin") || env.APP_URL;

  const result = await issueDownloadUrlForService(principal, correlationId, id, baseUrl);
  return serviceResponse(result, correlationId);
}
