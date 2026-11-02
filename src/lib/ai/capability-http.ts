import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { apiError, type ApiResponse } from "@/lib/response";

export function capabilityError(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json(apiError("Invalid capability request", "VALIDATION_ERROR", undefined, 400), { status: 400 });
  if (error && typeof error === "object" && "status" in error) {
    const response = error as ApiResponse; return NextResponse.json(response, { status: response.status });
  }
  return NextResponse.json(apiError("Request storage unavailable; setup or administrator review is required", "CAPABILITY_STORAGE_UNAVAILABLE", undefined, 503), { status: 503 });
}

export async function readCapabilityJson(request: Request, maximumBytes: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Body required");
  const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw apiError("Request too large", "PAYLOAD_TOO_LARGE", undefined, 413);
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
