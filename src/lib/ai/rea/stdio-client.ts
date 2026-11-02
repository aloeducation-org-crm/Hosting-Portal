/** Bounded MCP JSON-RPC over a runner-owned stdio transport. Never spawns a shell. */
import type { Readable, Writable } from "node:stream";

export interface ReaStdioTransport {
  stdout: Readable;
  stdin: Writable;
  /** Must terminate/reap the isolated runner process, not just close its pipes. */
  terminate: () => void;
}

export class ReaStdioClient {
  private buffer = Buffer.alloc(0);
  private received = 0;
  private sequence = 0;
  private ended = false;
  private pending?: { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private readonly onData = (chunk: Buffer | string) => {
    if (this.ended) return;
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.received += data.length;
    if (this.received > 2 * 1024 * 1024 || this.buffer.length + data.length > 512 * 1024) {
      this.stop(new Error("REA output exceeded its bounded session budget.")); return;
    }
    this.buffer = Buffer.concat([this.buffer, data]);
    let newline: number;
    while (!this.ended && (newline = this.buffer.indexOf(10)) >= 0) {
      const line = this.buffer.subarray(0, newline).toString("utf8");
      this.buffer = this.buffer.subarray(newline + 1);
      if (!line.trim()) continue;
      let message: Record<string, unknown>;
      try { message = JSON.parse(line); } catch { this.stop(new Error("REA emitted invalid JSON-RPC.")); return; }
      if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
        this.stop(new Error("Invalid REA protocol envelope.")); return;
      }
      if (typeof message.method === "string") {
        // No sampling, elicitation, roots or other server-initiated requests.
        if ("id" in message) { this.stop(new Error("REA requested an unsupported client capability.")); return; }
        continue; // Bounded notifications are not instructions or evidence.
      }
      if (!this.pending || message.id !== this.pending.id || (("result" in message) === ("error" in message))) {
        this.stop(new Error("Unexpected REA response identity or shape.")); return;
      }
      const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer);
      if ("error" in message) {
        // Do not expose raw provider errors, paths or content in exceptions.
        pending.reject(new Error("REA returned a protocol error.")); this.stop(); return;
      }
      pending.resolve(message.result);
    }
  };
  private readonly onEnd = () => this.stop(new Error("REA transport closed before the session completed."));
  private readonly onError = () => this.stop(new Error("REA transport failed."));

  constructor(private readonly transport: ReaStdioTransport, private readonly timeoutMs = 15000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error("Invalid REA request timeout.");
    transport.stdout.on("data", this.onData);
    transport.stdout.on("end", this.onEnd);
    transport.stdout.on("error", this.onError);
    transport.stdin.on("error", this.onError);
  }

  private send(message: unknown) {
    const payload = JSON.stringify(message) + "\n";
    if (Buffer.byteLength(payload) > 16384) throw new Error("REA request is too large.");
    this.transport.stdin.write(payload, (error) => { if (error) this.onError(); });
  }

  request(method: "initialize" | "tools/list" | "tools/call", params: Record<string, unknown>): Promise<unknown> {
    if (this.ended) return Promise.reject(new Error("REA session is closed."));
    if (this.pending) return Promise.reject(new Error("Concurrent REA requests are not permitted."));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.stop(new Error("REA request timed out.")), this.timeoutMs);
      this.pending = { id, resolve, reject, timer };
      try { this.send({ jsonrpc: "2.0", id, method, params }); }
      catch { this.stop(new Error("Could not send REA request.")); }
    });
  }

  initialized() {
    if (this.ended) throw new Error("REA session is closed.");
    try { this.send({ jsonrpc: "2.0", method: "notifications/initialized" }); }
    catch { this.stop(new Error("Could not initialize REA transport.")); throw new Error("Could not initialize REA transport."); }
  }

  close() { this.stop(); }

  private stop(error = new Error("REA session closed.")) {
    if (this.ended) return;
    this.ended = true;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    this.buffer = Buffer.alloc(0);
    // Keep error handlers attached: late stream errors must not crash the panel.
    this.transport.stdout.off("data", this.onData);
    this.transport.stdout.off("end", this.onEnd);
    try { this.transport.terminate(); } catch { /* Runner cleanup must be separately audited. */ }
  }
}
