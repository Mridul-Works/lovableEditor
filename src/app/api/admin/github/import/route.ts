import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { normalizeRoute } from "@/lib/importer/extract";
import { importRepoPage, type RepoPageResult } from "@/lib/importer/github-import";

// Import (or re-sync) one page of a connected project. The whole-project sync
// calls this once per page. It is a route handler rather than a server action
// because server actions from one client run strictly one after another, and
// a project sync wants a few pages in flight at once.

export const dynamic = "force-dynamic";
// A first import downloads every image the page references.
export const maxDuration = 300;

const SEGMENT = /^[\w.-]+$/;

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same-origin only: this endpoint changes content on the strength of a cookie.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const owner = String(body.owner ?? "");
  const repo = String(body.repo ?? "");
  const pagePath = String(body.pagePath ?? "");
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo) || !/^src\/[\w./$-]+\.(tsx|jsx)$/.test(pagePath) || pagePath.includes("..")) {
    return NextResponse.json({ error: "Invalid project or page path" }, { status: 400 });
  }

  let route: string;
  try {
    route = normalizeRoute(String(body.route ?? ""));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid route." }, { status: 400 });
  }

  let result: RepoPageResult;
  try {
    result = await importRepoPage({ owner, repo, pagePath, route, publishNew: body.publishNew === true });
  } catch (e) {
    // Extractor and GitHub errors carry admin-facing text; database errors do not.
    const isDb = typeof (e as { code?: unknown })?.code === "string" && /^P\d{4}$/.test((e as { code: string }).code);
    if (isDb) console.error("[github import] database error", e);
    result = { error: isDb ? "Import failed." : e instanceof Error ? e.message : "Import failed." };
  }
  return NextResponse.json(result, { status: result.error ? 422 : 200, headers: { "Cache-Control": "no-store" } });
}
