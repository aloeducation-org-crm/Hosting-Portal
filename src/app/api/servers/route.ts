import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireAdmin } from "@/lib/auth";
import { callHelper } from "@/lib/helpers";
import { db } from "@/lib/db";

const createServerSchema = z.object({
  name: z.string().min(1).optional(),
  hostname: z.string().min(2, "Hostname is required"),
  ip: z.string().min(3, "IP address is required"),
  tailscaleIp: z.string().optional(),
  region: z.string().default("ap-south-1"),
  role: z.enum(["WEB", "DATABASE", "AI", "LOAD_BALANCER"]).default("WEB"),
  status: z.enum(["ACTIVE", "ERROR", "PROVISIONING", "ONLINE", "OFFLINE", "MAINTENANCE"]).default("ONLINE"),
  os: z.string().default("Ubuntu 22.04.5 LTS"),
  cpuCores: z.coerce.number().int().min(1).default(4),
  ramGb: z.coerce.number().int().min(1).default(15),
  diskGb: z.coerce.number().int().min(10).default(100),
  maxSites: z.coerce.number().int().min(1).default(100),
});

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    let systemData: Record<string, unknown> = {};
    const sysResult = await callHelper("alo-health-helper", ["system-info"]);
    if (sysResult.success) {
      try {
        systemData = JSON.parse(sysResult.stdout);
      } catch {
        systemData = {};
      }
    }

    let servers = await db.server.findMany({
      include: {
        ports: true,
        metrics: {
          orderBy: { recordedAt: "desc" },
          take: 5,
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (servers.length === 0) {
      const created = await db.server.create({
        data: {
          name: "Primary Edge & App Node",
          hostname: (systemData.hostname as string) || "hosting.alolabs.net",
          ip: "100.85.239.114",
          os: "Ubuntu 22.04.5 LTS",
          cpuCores: 4,
          ramGb: 15,
          diskGb: 100,
          status: "ONLINE",
          role: "WEB",
          region: "ap-south-1",
          maxSites: 250,
        },
        include: { ports: true, metrics: true },
      });
      servers = [created];
    }

    return NextResponse.json(
      apiSuccess({
        ...servers[0],
        ...systemData,
        servers,
      })
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const body = await request.json();
    const input = createServerSchema.parse(body);

    const existing = await db.server.findUnique({
      where: { hostname: input.hostname },
    });
    if (existing) {
      return NextResponse.json(
        apiError("Server with this hostname already exists", "CONFLICT", undefined, 409),
        { status: 409 }
      );
    }

    const server = await db.server.create({
      data: {
        name: input.name || input.hostname,
        hostname: input.hostname,
        ip: input.ip,
        tailscaleIp: input.tailscaleIp || input.ip,
        region: input.region,
        role: input.role,
        status: input.status,
        os: input.os,
        cpuCores: input.cpuCores,
        ramGb: input.ramGb,
        diskGb: input.diskGb,
        maxSites: input.maxSites,
      },
    });

    await db.auditLog.create({
      data: {
        actorUserId: admin.id,
        actorEmail: admin.email,
        actorRole: admin.role,
        action: "SERVER_PROVISION",
        resourceType: "Server",
        resourceId: server.id,
        result: "SUCCESS",
      },
    });

    return NextResponse.json(apiSuccess(server, "Server provisioned", 201), { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        apiError("Validation failed", "VALIDATION_ERROR", e.flatten(), 400),
        { status: 400 }
      );
    }
    return handleErr(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const patchSchema = z.object({
      id: z.string().uuid(),
      status: z.enum(["ACTIVE", "ERROR", "PROVISIONING", "ONLINE", "OFFLINE", "MAINTENANCE"]).optional(),
      name: z.string().min(1).max(120).optional(),
      maxSites: z.number().int().min(1).max(100000).optional(),
      role: z.string().min(1).max(64).optional(),
      region: z.string().min(1).max(64).optional(),
    });
    const { id, status, name, maxSites, role, region } = patchSchema.parse(await request.json());

    if (!id) {
      return NextResponse.json(
        apiError("Server id is required", "VALIDATION_ERROR", undefined, 400),
        { status: 400 }
      );
    }

    const updated = await db.server.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(name ? { name } : {}),
        ...(maxSites !== undefined ? { maxSites: Number(maxSites) } : {}),
        ...(role ? { role } : {}),
        ...(region ? { region } : {}),
      },
    });

    await db.auditLog.create({
      data: {
        actorUserId: admin.id,
        actorEmail: admin.email,
        actorRole: admin.role,
        action: "SERVER_UPDATE",
        resourceType: "Server",
        resourceId: updated.id,
        result: "SUCCESS",
      },
    });

    return NextResponse.json(apiSuccess(updated, "Server updated"));
  } catch (e) {
    return handleErr(e);
  }
}
