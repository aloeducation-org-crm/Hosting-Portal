import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyInternalSecretValue } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);

/**
 * Allowlisted internal automation commands.
 *
 * Preserved from the retired nested /api/automation/tool route, but adapted to
 * the unified project: the service is alo-hosting-panel (not the legacy app
 * name), the service manager is configurable, and every executable/argument is
 * a compile-time constant. No user string ever reaches a shell.
 */
type ActionSpec = {
  cmd: string;
  args: string[];
  requiresApproval: boolean;
  serviceManager: "systemd" | "pm2";
};

function allowlist(): Record<string, ActionSpec> {
  const manager = process.env.AUTOMATION_SERVICE_MANAGER === "pm2" ? "pm2" : "systemd";
  const name = process.env.AUTOMATION_SERVICE_NAME || "alo-hosting-panel";
  const restart =
    manager === "pm2"
      ? { cmd: "pm2", args: ["reload", name, "--update-env"] }
      : { cmd: "systemctl", args: ["restart", name] };
  const status =
    manager === "pm2"
      ? { cmd: "pm2", args: ["jlist"] }
      : { cmd: "systemctl", args: ["status", name, "--no-pager", "--lines", "20"] };
  return {
    "restart-app": { ...restart, requiresApproval: true, serviceManager: manager },
    "system-status": { ...status, requiresApproval: false, serviceManager: manager },
  };
}

export async function POST(req: NextRequest) {
  const header = req.headers.get("authorization");
  const supplied = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const expected = process.env.INTERNAL_SECRET;

  if (!verifyInternalSecretValue(supplied, expected)) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  let body: { action?: string; approved?: boolean };
  try {
    body = (await req.json()) as { action?: string; approved?: boolean };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const spec = body.action ? allowlist()[body.action] : undefined;
  if (!spec) {
    return NextResponse.json({ success: false, error: "Disallowed command action" }, { status: 403 });
  }
  if (spec.requiresApproval && body.approved !== true) {
    return NextResponse.json(
      { success: false, requiresApproval: true, message: `Action "${body.action}" requires explicit approval` },
      { status: 409 },
    );
  }

  await createAuditLog({
    action: `automation.tool.${body.action}`,
    result: "REQUESTED",
    metadata: { serviceManager: spec.serviceManager, approved: body.approved === true },
  });

  try {
    const { stdout, stderr } = await execFileAsync(spec.cmd, spec.args, {
      timeout: 30_000,
      maxBuffer: 512 * 1024,
    });
    return NextResponse.json({
      success: true,
      action: body.action,
      serviceManager: spec.serviceManager,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.warn({ action: body.action, error }, "automation tool command failed");
    return NextResponse.json({ success: false, error: "Command execution failed" }, { status: 500 });
  }
}
