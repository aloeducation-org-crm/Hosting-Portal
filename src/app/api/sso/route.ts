import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { sealSecretValue, maskSecretValue } from "@/lib/secret-store";
import { createAuditLog } from "@/lib/audit";

const SSO_SETTING_KEY = "auth.sso.config";
const SSO_SETTING_TYPE = "sso_config";

const ssoConfigSchema = z
  .object({
    provider: z.string().trim().min(1).max(64),
    clientId: z.string().trim().min(1).max(256),
    clientSecret: z.string().min(8).max(512),
    metadataUrl: z.string().url().optional().nullable(),
    enabled: z.boolean(),
  })
  .strict();

interface StoredSsoConfig {
  provider: string;
  clientId: string;
  clientSecret: string; // sealed with enc:v1: AES-256-GCM
  metadataUrl: string | null;
  enabled: boolean;
  updatedAt: string;
}

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin(request);

    const row = await db.secret.findFirst({
      where: { name: SSO_SETTING_KEY, type: SSO_SETTING_TYPE },
      orderBy: { updatedAt: "desc" },
    });

    let config: Partial<StoredSsoConfig> = {};
    if (row?.value) {
      try {
        config = JSON.parse(row.value) as Partial<StoredSsoConfig>;
      } catch {
        config = {};
      }
    }

    const rawSecret = config.clientSecret ?? process.env.SSO_CLIENT_SECRET ?? "";
    return NextResponse.json(
      apiSuccess({
        enabled: config.enabled ?? process.env.SSO_ENABLED === "true",
        provider: config.provider ?? process.env.SSO_PROVIDER ?? null,
        clientId: config.clientId ?? process.env.SSO_CLIENT_ID ?? null,
        clientSecret: rawSecret ? maskSecretValue(rawSecret) : "",
        metadataUrl: config.metadataUrl ?? process.env.SSO_METADATA_URL ?? null,
        storage: "database-encrypted",
        runtimeWired: false,
      }),
    );
  } catch (e) {
    return handleErr(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireSuperAdmin(request);
    const parsed = ssoConfigSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Invalid SSO configuration", "INVALID_INPUT", parsed.error.flatten().fieldErrors, 400),
        { status: 400 },
      );
    }

    const { provider, clientId, clientSecret, metadataUrl, enabled } = parsed.data;
    const stored: StoredSsoConfig = {
      provider,
      clientId,
      clientSecret: sealSecretValue(clientSecret),
      metadataUrl: metadataUrl ?? null,
      enabled,
      updatedAt: new Date().toISOString(),
    };

    const existing = await db.secret.findFirst({
      where: { name: SSO_SETTING_KEY, type: SSO_SETTING_TYPE },
      orderBy: { updatedAt: "desc" },
    });

    if (existing) {
      await db.secret.update({
        where: { id: existing.id },
        data: { value: JSON.stringify(stored), userId: admin.id },
      });
    } else {
      await db.secret.create({
        data: {
          name: SSO_SETTING_KEY,
          type: SSO_SETTING_TYPE,
          value: JSON.stringify(stored),
          userId: admin.id,
        },
      });
    }

    await createAuditLog({
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.role,
      action: "SSO_CONFIG_UPDATED",
      resourceType: "Secret",
      resourceId: SSO_SETTING_KEY,
      result: "SUCCESS",
      metadata: { provider, enabled, hasMetadataUrl: Boolean(metadataUrl) },
    });

    return NextResponse.json(apiSuccess(null, "SSO configuration updated securely"));
  } catch (e) {
    return handleErr(e);
  }
}
