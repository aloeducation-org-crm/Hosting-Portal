import { NextRequest, NextResponse } from "next/server";
import { apiSuccess, apiError, type ApiResponse } from "@/lib/response";
import { requireSession } from "@/lib/auth";
import {
  FREE_FOR_DEV_SOURCE,
  getCategory,
  queryFreeServices,
} from "@/lib/free-for-dev/catalog";

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === "object" && "status" in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError("Internal server error"), { status: 500 });
}

/**
 * GET /api/free-for-dev — the Free for Dev service directory.
 *
 * Read-only view of the curated free-tier catalog (synced from the community
 * free-for.dev list; see `scripts/sync-free-for-dev.mjs`). Optional filters:
 *   ?category=<id>  one category id from the returned category list
 *   ?q=<text>       case-insensitive match on name, summary and detail text
 *   ?limit=<n>      cap the returned rows (1..1000); `total` still reports
 *                   the full match count so callers can page or count.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);

    const { searchParams } = new URL(request.url);
    const categoryId = (searchParams.get("category") ?? "").trim();
    const q = (searchParams.get("q") ?? "").trim();
    const limitRaw = (searchParams.get("limit") ?? "").trim();

    if (categoryId && !getCategory(categoryId)) {
      return NextResponse.json(apiError(`Unknown category "${categoryId}"`, "INVALID_CATEGORY", undefined, 400), {
        status: 400,
      });
    }

    let limit: number | undefined;
    if (limitRaw) {
      limit = Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        return NextResponse.json(apiError("limit must be an integer between 1 and 1000", "INVALID_LIMIT", undefined, 400), {
          status: 400,
        });
      }
    }

    const result = queryFreeServices({
      categoryId: categoryId || undefined,
      q: q || undefined,
      limit,
    });

    return NextResponse.json(apiSuccess({ source: FREE_FOR_DEV_SOURCE, ...result }));
  } catch (e) {
    return handleErr(e);
  }
}
