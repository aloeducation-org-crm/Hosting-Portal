import { NextRequest } from "next/server";
import { serviceResponse, requireServiceAuth } from "@/lib/integrations/crm-service-route";
import { getBackupStatusForService } from "@/lib/integrations/crm-storage-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/internal/crm/storage/backup — observable backup state.
 *
 * Reports only what can actually be observed: whether the backup pool is
 * configured, whether its backend path is accessible, and how many backup
 * objects are recorded.
 *
 * It explicitly returns `restoreVerified: false`. Verifying a backup requires
 * performing a restore, which this endpoint does not do, and asserting backup
 * success without a restore test is precisely the kind of unearned success this
 * integration is built to avoid.
 */
export async function GET(request: NextRequest) {
  const auth = await requireServiceAuth(request, "storage:backup:read");
  if (!auth.ok) return auth.response;
  const { principal, correlationId } = auth.context;

  const result = await getBackupStatusForService(principal);
  return serviceResponse(result, correlationId);
}
