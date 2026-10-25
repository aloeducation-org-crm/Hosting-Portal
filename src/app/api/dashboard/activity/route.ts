import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession, isAdminRole } from "@/lib/auth";
import { db } from "@/lib/db";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const isAdmin = isAdminRole(user.role);

    const logs = await db.auditLog.findMany({
      where: isAdmin ? {} : { actorUserId: user.id },
      orderBy: { timestamp: "desc" },
      take: 10,
    });

    const activities = logs.map((log) => {
      let type = "website";
      const act = log.action.toUpperCase();
      if (act.includes("DOMAIN") || act.includes("DNS") || act.includes("SSL")) {
        type = "domain";
      } else if (act.includes("AI") || act.includes("AGENT")) {
        type = "ai";
      } else if (act.includes("CRM") || act.includes("USER") || act.includes("LOGIN")) {
        type = "crm";
      }

      return {
        id: log.id,
        type,
        title: `${log.action.replace(/_/g, " ")}${log.domain ? ` (${log.domain})` : log.actorEmail ? ` — ${log.actorEmail}` : ""}`,
        date: log.timestamp.toISOString(),
        result: log.result || "SUCCESS",
      };
    });

    return NextResponse.json(apiSuccess({ activities, logs }));
  } catch (e) {
    return handleErr(e);
  }
}
