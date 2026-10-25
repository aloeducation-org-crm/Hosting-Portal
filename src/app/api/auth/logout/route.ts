import { NextResponse } from "next/server";
import { apiSuccess } from "@/lib/response";

export async function POST() {
  const response = NextResponse.json(apiSuccess({ loggedOut: true }, "Logged out successfully"));
  response.cookies.delete("next-auth.session-token");
  response.cookies.delete("__Secure-next-auth.session-token");
  return response;
}
