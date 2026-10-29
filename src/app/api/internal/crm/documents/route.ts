import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { serviceResponse, requireServiceAuth } from "@/lib/integrations/crm-service-route";
import { uploadDocumentForService } from "@/lib/integrations/crm-storage-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/internal/crm/documents — service-to-service document upload.
 *
 * This is the CRM's write path into the Hosting-Portal document vault. It is
 * authenticated by a scoped SERVICE CREDENTIAL, not a browser session, and every
 * document it creates is bound to the credential's organization.
 *
 * Multipart fields: poolKey, category, file, and optionally externalReference
 * (the CRM's Student ID, kept in the audit trail so a document can be traced
 * back to the student without the CRM having to expose it in a URL).
 *
 * Send `Idempotency-Key` and `X-Content-SHA256` headers: the first makes a retry
 * return the original result instead of storing a second document, the second
 * makes a corrupted or truncated upload fail BEFORE anything is written.
 *
 * The existing browser-session endpoint at /api/storage/documents is unchanged;
 * this is an additional, separately authorized path onto the same storage engine.
 */
export async function POST(request: NextRequest) {
  const auth = await requireServiceAuth(request, "storage:documents:upload");
  if (!auth.ok) return auth.response;
  const { principal, correlationId } = auth.context;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return serviceResponse(
      {
        ok: false,
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Expected multipart form data with poolKey, category and file",
      },
      correlationId,
    );
  }

  const parsed = z
    .object({
      poolKey: z.string().trim().min(1).max(64),
      category: z.string().trim().min(1).max(64),
      externalReference: z.string().trim().max(200).optional(),
    })
    .safeParse({
      poolKey: String(form.get("poolKey") ?? ""),
      category: String(form.get("category") ?? ""),
      externalReference: form.get("externalReference") ? String(form.get("externalReference")) : undefined,
    });

  if (!parsed.success) {
    return serviceResponse(
      { ok: false, status: 400, code: "VALIDATION_ERROR", message: "poolKey and category are required" },
      correlationId,
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return serviceResponse(
      { ok: false, status: 400, code: "VALIDATION_ERROR", message: "file is required" },
      correlationId,
    );
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch (error) {
    logger.error({ error, event: "crm.service.upload_read_failed", correlationId }, "Could not read upload body");
    return serviceResponse(
      { ok: false, status: 400, code: "VALIDATION_ERROR", message: "Could not read the uploaded file body" },
      correlationId,
    );
  }

  const result = await uploadDocumentForService(principal, correlationId, {
    poolKey: parsed.data.poolKey,
    category: parsed.data.category,
    filename: file.name,
    contentType: file.type,
    bytes,
    expectedSha256: request.headers.get("x-content-sha256"),
    externalReference: parsed.data.externalReference ?? null,
    idempotencyKey: request.headers.get("idempotency-key"),
  });

  return serviceResponse(result, correlationId);
}
