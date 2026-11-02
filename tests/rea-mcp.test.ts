import { afterEach, describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { ReaStdioClient } from "@/lib/ai/rea/stdio-client";
import { ReaAnalysisSession, REA_ANALYSIS_BASELINE, REA_STATIC_TOOLS, type ReaInspectionGrant } from "@/lib/ai/rea/analysis-session";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
function grant() {
  return { actorId: "admin-1", projectId: "project-1", approvalId: "approval-1", targetId: "artifact-1", targetSha256: "a".repeat(64), authorizedInspection: true as const, expiresAt: Date.now() + 60000, allowedTools: [...REA_STATIC_TOOLS] };
}
const target = { targetId: "artifact-1", sha256: "a".repeat(64), stagedPath: "/isolated/artifacts/approved.bin" };
const tool = (name: string) => ({ name, inputSchema: { type: "object" } });
const initialize = { protocolVersion: REA_ANALYSIS_BASELINE.protocol, serverInfo: { name: "rea-test-fixture", version: REA_ANALYSIS_BASELINE.version }, capabilities: { tools: {} } };
const evidence = { content: [{ type: "text", text: "Analysis observation; not recovered source." }] };
type Rpc = { id?: number; method: string; params: Record<string, unknown> };
function harness(handler?: (rpc: Rpc) => unknown, timeout = 1000) {
  const stdout = new PassThrough(); const stdin = new PassThrough();
  const requests: Rpc[] = []; let terminated = 0;
  stdin.on("data", (data) => {
    const rpc = JSON.parse(data.toString()) as Rpc; requests.push(rpc);
    if (!rpc.id) return;
    let result = handler ? handler(rpc) : undefined;
    if (result === undefined) result = rpc.method === "initialize" ? initialize : rpc.method === "tools/list" ? { tools: [...REA_STATIC_TOOLS.map(tool), tool("rea_push_adb_file"), tool("unknown_future_tool")] } : evidence;
    if (result !== null) stdout.write(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }) + "\n");
  });
  const client = new ReaStdioClient({ stdout, stdin, terminate: () => { terminated++; } }, timeout);
  cleanup.push(() => client.close());
  return { client, stdout, requests, terminated: () => terminated };
}

describe("bounded REA JSON-RPC transport", () => {
  it("times out a silent peer and terminates the transport", async () => {
    const h = harness(() => null, 20);
    await expect(h.client.request("initialize", {})).rejects.toThrow("timed out"); expect(h.terminated()).toBe(1);
  });
  it.each(["not-json\n", "null\n", '[]\n', '{"jsonrpc":"1.0"}\n', '{"jsonrpc":"2.0","id":99,"result":{}}\n', '{"jsonrpc":"2.0","id":1,"result":{},"error":{}}\n'])("fails closed on malformed/mismatched response %s", async (line) => {
    const h = harness(() => null); const pending = h.client.request("initialize", {}); h.stdout.write(line);
    await expect(pending).rejects.toThrow(); expect(h.terminated()).toBe(1);
  });
  it("rejects server-initiated requests instead of granting sampling or roots", async () => {
    const h = harness(() => null); const pending = h.client.request("initialize", {});
    h.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: "server-1", method: "sampling/createMessage", params: {} }) + "\n");
    await expect(pending).rejects.toThrow("unsupported client capability");
  });
  it("handles chunked responses and bounded notifications", async () => {
    const h = harness(() => null); const pending = h.client.request("initialize", {});
    const response = JSON.stringify({ jsonrpc: "2.0", id: 1, result: initialize }) + "\n";
    h.stdout.write('{"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n');
    h.stdout.write(response.slice(0, 17)); h.stdout.write(response.slice(17));
    expect(await pending).toEqual(initialize);
  });
  it("rejects excessive output, protocol errors and premature EOF", async () => {
    for (const kind of ["size", "error", "eof"]) {
      const h = harness(() => null); const pending = h.client.request("initialize", {});
      if (kind === "size") h.stdout.write("x".repeat(524289));
      if (kind === "error") h.stdout.write('{"jsonrpc":"2.0","id":1,"error":{"message":"secret raw error"}}\n');
      if (kind === "eof") h.stdout.emit("end");
      await expect(pending).rejects.not.toThrow("secret raw error"); expect(h.terminated()).toBe(1);
    }
  });
  it("refuses concurrent requests", async () => {
    const h = harness(() => null); const pending = h.client.request("initialize", {});
    await expect(h.client.request("tools/list", {})).rejects.toThrow("Concurrent");
    h.client.close(); await expect(pending).rejects.toThrow();
  });
});

describe("target-bound static-analysis session", () => {
  it("handshakes before discovery, hides unreviewed tools and binds evidence", async () => {
    const h = harness(); const session = new ReaAnalysisSession(h.client, grant(), target);
    const configured = await session.initialize(); expect(configured.tools).toEqual([...REA_STATIC_TOOLS]);
    expect(h.requests.map((r) => r.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    const opened = await session.open(); await session.listProcedures(); await session.decompile("0x401000"); await session.finish();
    expect(opened).toMatchObject({ targetId: target.targetId, targetSha256: target.sha256, approvalId: "approval-1" });
    expect(opened.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    const call = h.requests.find((r) => r.method === "tools/call")!;
    expect(call.params).toEqual({ name: "rea_open_binary", arguments: { path: target.stagedPath, provider_id: "ghidra" } });
    expect(h.terminated()).toBe(1);
  });
  it.each([{ authorizedInspection: false }, { targetSha256: "b".repeat(64) }, { expiresAt: 1 }, { expiresAt: Date.now() + 7200000 }, { allowedTools: ["unknown_tool"] }])("refuses invalid approval before sending anything %j", (override) => {
    const h = harness(); expect(() => new ReaAnalysisSession(h.client, { ...grant(), ...override } as ReaInspectionGrant, target)).toThrow();
    expect(h.requests).toHaveLength(0); expect(h.terminated()).toBe(1);
  });
  it("refuses path escape and missing lifecycle authority", () => {
    const h = harness(); expect(() => new ReaAnalysisSession(h.client, grant(), { ...target, stagedPath: "/isolated/../production.bin" })).toThrow();
    const h2 = harness(); expect(() => new ReaAnalysisSession(h2.client, { ...grant(), allowedTools: ["rea_open_binary"] }, target)).toThrow();
  });
  it("fails when the pinned protocol/version or granted tools are unavailable", async () => {
    for (const kind of ["protocol", "version", "missing"]) {
      const h = harness((r) => r.method === "initialize" ? { ...initialize, ...(kind === "protocol" ? { protocolVersion: "unexpected" } : {}), serverInfo: { ...initialize.serverInfo, ...(kind === "version" ? { version: "99.0.0" } : {}) } } : kind === "missing" ? { tools: [] } : undefined);
      const session = new ReaAnalysisSession(h.client, grant(), target);
      await expect(session.initialize()).rejects.toThrow("handshake/discovery failed"); expect(h.terminated()).toBe(1);
    }
  });
  it("supports pagination and rejects repeated cursors", async () => {
    const h = harness((r) => r.method === "tools/list" ? r.params.cursor ? { tools: REA_STATIC_TOOLS.slice(2).map(tool) } : { tools: REA_STATIC_TOOLS.slice(0, 2).map(tool), nextCursor: "page2" } : undefined);
    await new ReaAnalysisSession(h.client, grant(), target).initialize();
    expect(h.requests.filter((r) => r.method === "tools/list")).toHaveLength(2);
    const bad = harness((r) => r.method === "tools/list" ? { tools: [], nextCursor: "same" } : undefined);
    await expect(new ReaAnalysisSession(bad.client, grant(), target).initialize()).rejects.toThrow();
  });
  it("does not accept extra approval fields, arbitrary procedures, or tool failures", async () => {
    const first = harness(); expect(() => new ReaAnalysisSession(first.client, { ...grant(), command: "bash" } as ReaInspectionGrant, target)).toThrow();
    const h = harness((r) => r.method === "tools/call" && r.params.name === "rea_procedure_pseudo_code" ? { ...evidence, isError: true } : undefined);
    const session = new ReaAnalysisSession(h.client, grant(), target); await session.initialize(); await session.open();
    await expect(session.decompile("0x123; rm -rf /")).rejects.toThrow();
    await expect(session.decompile("0x401000")).rejects.toThrow("analysis failed"); expect(h.terminated()).toBe(1);
  });
  it("enforces the call budget", async () => {
    const h = harness(); const session = new ReaAnalysisSession(h.client, grant(), target); await session.initialize(); await session.open();
    for (let i = 0; i < 23; i++) await session.listProcedures();
    await expect(session.listProcedures()).rejects.toThrow(); expect(h.terminated()).toBe(1);
  });
  it("terminates an idle transport when the approval expires", async () => {
    const h = harness(); new ReaAnalysisSession(h.client, { ...grant(), expiresAt: Date.now() + 30 }, target);
    await new Promise((resolve) => setTimeout(resolve, 60)); expect(h.terminated()).toBe(1);
  });
});

describe("actual child-process stdio integration (fixture, NOT upstream REA)", () => {
  it("performs handshake, discovery, analysis calls and termination without a shell", async () => {
    const fixture = `const readline = require('node:readline');
const tools = ${JSON.stringify(REA_STATIC_TOOLS)};
readline.createInterface({input:process.stdin}).on('line', line => {
 const r = JSON.parse(line); if (!r.id) return;
 const result = r.method === 'initialize' ? ${JSON.stringify(initialize)} : r.method === 'tools/list' ? {tools:tools.map(name=>({name,inputSchema:{type:'object'}}))} : ${JSON.stringify(evidence)};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
});`;
    const child = spawn(process.execPath, ["-e", fixture], { stdio: ["pipe", "pipe", "ignore"], shell: false, env: {} });
    const exit = once(child, "exit");
    const client = new ReaStdioClient({ stdin: child.stdin, stdout: child.stdout, terminate: () => { child.kill("SIGKILL"); } }, 3000);
    cleanup.push(() => { client.close(); child.kill("SIGKILL"); });
    const session = new ReaAnalysisSession(client, grant(), target);
    await session.initialize(); await session.open(); const result = await session.decompile("0x401000"); await session.finish();
    expect(result.result.content[0].text).toContain("Analysis observation");
    await exit;
  });
});
