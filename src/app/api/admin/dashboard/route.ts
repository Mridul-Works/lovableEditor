import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard";

// Dashboard data for TanStack Query to poll. `?refresh=1` bypasses the
// per-project GitHub cache (the Refresh button); polling uses the cache.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await getDashboardData({ refresh: request.nextUrl.searchParams.get("refresh") === "1" });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
