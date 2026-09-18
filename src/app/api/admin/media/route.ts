import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import type { MediaPageResponse } from "@/lib/editor-types";

// Media library, newest first, cursor-paginated for the editor's picker. The
// picker asks for images or videos, filtered by filename substring.

export const dynamic = "force-dynamic";

const PAGE_SIZE = 48;

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif)$/i;

export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const kind = request.nextUrl.searchParams.get("kind") === "video" ? "video" : "image";
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const cursor = request.nextUrl.searchParams.get("cursor") || null;

  // The kind lives in the file extension, which SQL can't filter portably
  // across SQLite and Postgres without case-insensitive LIKE gymnastics, so
  // pages are read a little wide and filtered here.
  const assets: MediaPageResponse["assets"] = [];
  let nextCursor: string | null = cursor;
  for (let round = 0; round < 6 && assets.length < PAGE_SIZE; round++) {
    const batch = await db.mediaAsset.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE,
      ...(nextCursor ? { skip: 1, cursor: { id: nextCursor } } : {}),
    });
    if (batch.length === 0) {
      nextCursor = null;
      break;
    }
    for (const a of batch) {
      const isVideo = VIDEO_EXT.test(a.url);
      const isImage = IMAGE_EXT.test(a.url);
      if (kind === "video" ? !isVideo : !isImage) continue;
      if (q && !a.filename.toLowerCase().includes(q) && !a.url.toLowerCase().includes(q)) continue;
      assets.push({
        id: a.id, url: a.url, filename: a.filename, width: a.width, height: a.height,
        size: a.size, createdAt: a.createdAt.toISOString(),
      });
      if (assets.length >= PAGE_SIZE) break;
    }
    nextCursor = batch.length < PAGE_SIZE ? null : batch[batch.length - 1].id;
    if (nextCursor === null) break;
  }

  const body: MediaPageResponse = { assets, nextCursor };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
