import { NextRequest } from "next/server";
import { serviceResponse, requireServiceAuth } from "@/lib/integrations/crm-service-route";
import { getStorageHealthForService } from "@/lib/integrations/crm-storage-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/crm/storage/health — can the storage backend actually take
 * and return bytes right now?
 *
 * PROBES the filesystem rather than reporting health from configuration, so a
 * pool whose backend has been unmounted or made unwritable reports degraded. The
 * CRM uses this to decide whether to queue uploads instead of losing them during
 * an outage.
 */
export async function GET(request: NextRequest) {
  const auth = await requireServiceAuth(request, "storage:health:read");
  if (!auth.ok) return auth.response;
  const { principal, correlationId } = auth.context;

  const result = await getStorageHealthForService(principal);
  return serviceResponse(result, correlationId);
}
