import { NextResponse } from "next/server";

export async function GET() {
  try {
    return NextResponse.json({ status: "ok", service: "ALO Labs AgentOS", timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}