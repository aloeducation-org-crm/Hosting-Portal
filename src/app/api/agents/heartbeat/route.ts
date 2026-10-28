import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError } from "@/lib/response";
import { recordHeartbeat } from "@/lib/agents/agent";
import { requireAgent, parseBody, clientIp } from "@/lib/agents/http";

const metricsSchema = z
  .object({
    cpuPercent: z.number().min(-1).max(100).nullish(),
    memoryUsedMb: z.number().min(0).nullish(),
    memoryTotalMb: z.number().min(0).nullish(),
    diskUsedGb: z.number().min(0).nullish(),
    diskTotalGb: z.number().min(0).nullish(),
    loadAvg1m: z.number().min(0).nullish(),
    uptimeSeconds: z.number().min(0).nullish(),
    netInKbps: z.number().min(0).nullish(),
    netOutKbps: z.number().min(0).nullish(),
    services: z.array(z.object({ name: z.string().max(120), state: z.string().max(40) })).max(50).nullish(),
  })
  .nullish();

const inventorySchema = z
  .object({
    hostname: z.string().max(253).optional(),
    platform: z.string().max(40).optional(),
    arch: z.string().max(40).optional(),
    kernel: z.string().max(80).optional(),
    cpuCores: z.number().int().min(0).max(1024).optional(),
    cpuModel: z.string().max(120).optional(),
    ramGb: z.number().min(0).max(4096).optional(),
    uptimeSeconds: z.number().min(0).optional(),
  })
  .nullish();

const payloadSchema = z.object({
  version: z.string().max(40).optional(),
  capabilities: z.array(z.string().max(64)).max(60).optional(),
  metrics: metricsSchema,
  inventory: inventorySchema,
});

/**
 * Signed agent heartbeat. Persists the metrics the agent actually measured and
 * mirrors the newest values onto its Server row so the existing servers UI shows
 * real numbers. A missing metric stays null — it is never defaulted to 0.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.ok) {
    return NextResponse.json(apiError(auth.message, auth.code, undefined, auth.status), { status: auth.status });
  }

  const raw = parseBody(auth.body);
  if (raw === null) {
    return NextResponse.json(apiError("Request body is not valid JSON", "VALIDATION_ERROR", undefined, 400), { status: 400 });
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(apiError("Heartbeat payload failed validation", "VALIDATION_ERROR", parsed.error.flatten(), 400), { status: 400 });
  }

  const agent = await recordHeartbeat(
    auth.agent.id,
    {
      version: parsed.data.version,
      capabilities: parsed.data.capabilities,
      metrics: parsed.data.metrics ?? null,
      inventory: parsed.data.inventory ?? null,
    },
    clientIp(request),
  );

  return NextResponse.json(
    apiSuccess({
      agentId: agent.id,
      serverTime: new Date().toISOString(),
      nextHeartbeatMs: 60_000,
    }, "Heartbeat recorded"),
  );
}
