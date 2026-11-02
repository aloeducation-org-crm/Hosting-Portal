import { z } from "zod";
import { createHash } from "node:crypto";
import { ReaStdioClient } from "./stdio-client";

/** These contracts were sampled at upstream REA commit d9e01e5. No live compatibility claim. */
export const REA_ANALYSIS_BASELINE = { package: "rea-agents", version: "6.8.0", protocol: "2025-03-26" } as const;
export const REA_STATIC_TOOLS = ["rea_open_binary", "rea_list_procedures", "rea_procedure_pseudo_code", "rea_close_binary"] as const;
const toolNames = z.enum(REA_STATIC_TOOLS);
const grantSchema = z.object({
  actorId: z.string().min(1).max(128), projectId: z.string().min(1).max(128),
  approvalId: z.string().min(1).max(128), targetId: z.string().min(1).max(128),
  targetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  authorizedInspection: z.literal(true), expiresAt: z.number().int().positive(),
  allowedTools: z.array(toolNames).min(1).max(4),
}).strict();
export type ReaInspectionGrant = z.infer<typeof grantSchema>;
export interface VerifiedReaTarget {
  /** A trusted runner must resolve/hash a regular, immutable staged file. */
  targetId: string; sha256: string; stagedPath: string;
}
const replySchema = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string().max(131072) }).strict()).max(16), isError: z.boolean().optional(), structuredContent: z.unknown().optional() }).strict();

/**
 * Isolated, single-target native static analysis only. Never browser navigation,
 * debugger attach, arbitrary commands or writes to a target. Grants/transport
 * are trusted runner dependencies, NOT an HTTP/model-supplied authorization.
 */
export class ReaAnalysisSession {
  private state: "new" | "ready" | "open" | "closed" = "new";
  private discovered = new Set<string>();
  private grant: ReaInspectionGrant;
  private target: VerifiedReaTarget;
  private calls = 0;
  private expiryTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly client: ReaStdioClient, grant: ReaInspectionGrant, target: VerifiedReaTarget) {
    try {
      this.grant = grantSchema.parse(grant);
      this.target = { ...target };
      if (this.grant.targetId !== target.targetId || this.grant.targetSha256 !== target.sha256 ||
        !/^\/[A-Za-z0-9_./-]+$/.test(target.stagedPath) || target.stagedPath.split("/").some((p) => p === "." || p === "..") ||
        !this.grant.allowedTools.includes("rea_open_binary") || !this.grant.allowedTools.includes("rea_close_binary")) throw new Error("Invalid target scope.");
      this.assertGrant();
      const remaining = this.grant.expiresAt - Date.now();
      if (remaining > 3600000) throw new Error("Inspection approval exceeds one hour.");
      this.expiryTimer = setTimeout(() => this.close(), remaining);
      this.expiryTimer.unref();
    } catch { client.close(); throw new Error("REA requires a valid, target-bound inspection grant."); }
  }

  private assertGrant() {
    if (this.grant.expiresAt <= Date.now()) throw new Error("REA inspection approval has expired.");
  }

  async initialize() {
    if (this.state !== "new") throw new Error("REA session already initialized or closed.");
    try {
      this.assertGrant();
      const info = z.object({ protocolVersion: z.literal(REA_ANALYSIS_BASELINE.protocol), capabilities: z.object({ tools: z.object({}).passthrough() }).passthrough(), serverInfo: z.object({ name: z.string().min(1), version: z.literal(REA_ANALYSIS_BASELINE.version) }).passthrough() }).passthrough().parse(
        await this.client.request("initialize", { protocolVersion: REA_ANALYSIS_BASELINE.protocol, capabilities: {}, clientInfo: { name: "alo-internal-rea", version: "0.1.0" } }),
      );
      void info;
      this.assertGrant();
      this.client.initialized();
      let cursor: string | undefined;
      const cursors = new Set<string>();
      for (let page = 0; page < 8; page++) {
        const result = z.object({ tools: z.array(z.object({ name: z.string().min(1).max(160), inputSchema: z.record(z.string(), z.unknown()) }).passthrough()).max(256), nextCursor: z.string().min(1).max(1024).optional() }).passthrough().parse(
          await this.client.request("tools/list", cursor ? { cursor } : {}),
        );
        this.assertGrant();
        for (const tool of result.tools) if ((REA_STATIC_TOOLS as readonly string[]).includes(tool.name) && this.grant.allowedTools.includes(tool.name as typeof REA_STATIC_TOOLS[number])) this.discovered.add(tool.name);
        if (!result.nextCursor) {
          if (this.grant.allowedTools.some((name) => !this.discovered.has(name))) throw new Error("Approved REA tools are unavailable.");
          this.state = "ready"; return { state: "CONFIGURED" as const, tools: [...this.discovered] };
        }
        if (cursors.has(result.nextCursor)) throw new Error("REA discovery cursor repeated.");
        cursors.add(result.nextCursor); cursor = result.nextCursor;
      }
      throw new Error("REA discovery exceeded page limit.");
    } catch { this.close(); throw new Error("REA handshake/discovery failed; no analysis was authorized."); }
  }

  private async call(name: typeof REA_STATIC_TOOLS[number], args: Record<string, unknown>) {
    try {
      this.assertGrant();
      if (!this.discovered.has(name) || ++this.calls > 24) throw new Error("Tool not allowed or session budget exhausted.");
      const result = replySchema.parse(await this.client.request("tools/call", { name, arguments: args }));
      this.assertGrant();
      if (result.isError) throw new Error("REA tool reported failure.");
      // Evidence is untrusted: no HTML rendering, shell interpolation or authority.
      return { actorId: this.grant.actorId, projectId: this.grant.projectId, targetId: this.target.targetId, targetSha256: this.target.sha256, approvalId: this.grant.approvalId, tool: name, observedAt: new Date().toISOString(),
        evidenceSha256: createHash("sha256").update(JSON.stringify(result)).digest("hex"), result };
    } catch { this.close(); throw new Error("REA analysis failed or approval is no longer valid."); }
  }

  async open() {
    if (this.state !== "ready") throw new Error("REA is not ready to open its approved target.");
    const result = await this.call("rea_open_binary", { path: this.target.stagedPath, provider_id: "ghidra" });
    this.state = "open"; return result;
  }
  async listProcedures() {
    if (this.state !== "open") throw new Error("No approved REA target is open.");
    return this.call("rea_list_procedures", { detail: "summary" });
  }
  async decompile(procedure: string) {
    if (this.state !== "open") throw new Error("No approved REA target is open.");
    const validated = z.string().regex(/^0x[a-fA-F0-9]{1,16}$/).parse(procedure);
    return this.call("rea_procedure_pseudo_code", { procedure: validated });
  }
  async finish() {
    try { if (this.state === "open") await this.call("rea_close_binary", {}); }
    finally { this.close(); }
  }
  close() { this.state = "closed"; if (this.expiryTimer) clearTimeout(this.expiryTimer); this.discovered.clear(); this.client.close(); }
}
