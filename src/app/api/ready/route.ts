import { NextResponse } from "next/server";
import { buildReadinessReport } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * Readiness probe — the endpoint a load balancer or orchestrator hits.
 *
 * Unlike `/api/health`, this returns the smallest possible body and discloses
 * nothing about the deployment (no paths, hosts, versions or schema detail),
 * so it is safe to expose on a public health-check port. It shares the probes
 * with the health report; a 200 here can never contradict a healthy
 * `/api/health`.
 */
export async function GET() {
  const report = await buildReadinessReport();
  return NextResponse.json(report, {
    status: report.ready ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
