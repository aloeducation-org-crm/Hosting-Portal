import { NextRequest } from "next/server";
import { serviceResponse, requireServiceAuth } from "@/lib/integrations/crm-service-route";
import { getQuotaForService } from "@/lib/integrations/crm-storage-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/crm/storage/quota[?poolKey=…] — pool usage and quota for the
 * caller's tenant.
 *
 * Lets the CRM check headroom BEFORE attempting an upload instead of discovering
 * a 413 after transferring the file. Figures come from the database, and a pool
 * that is not provisioned reports `provisioned: false` rather than looking like a
 * healthy empty pool.
 */
export async function GET(request: NextRequest) {
  const auth = await requireServiceAuth(request, "storage:quota:read");
  if (!auth.ok) return auth.response;
  const { principal, correlationId } = auth.context;

  const poolKey = request.nextUrl.searchParams.get("poolKey") ?? undefined;
  const result = await getQuotaForService(principal, poolKey);
  return serviceResponse(result, correlationId);
}
