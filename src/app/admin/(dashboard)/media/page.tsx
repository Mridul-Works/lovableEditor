import Link from "next/link";
import { db } from "@/lib/db";
import { MediaGrid } from "@/components/admin/MediaGrid";

export const dynamic = "force-dynamic";

// The reference-count query below scans fields for every asset on the page, so
// the page size bounds that work as well as the DOM.
const PER_PAGE = 60;

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const requested = Number.parseInt((await searchParams).page ?? "1", 10);
  const pageNumber = Number.isFinite(requested) && requested > 0 ? requested : 1;
  const total = await db.mediaAsset.count();
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const current = Math.min(pageNumber, pageCount);

  const assets = await db.mediaAsset.findMany({
    orderBy: { createdAt: "desc" },
    skip: (current - 1) * PER_PAGE,
    take: PER_PAGE,
  });

  // Reference counts so deletes can warn (computed server-side in one pass).
  const urls = assets.map((a) => a.url);
  const referencedFields = urls.length
    ? await db.field.findMany({
        where: { OR: [{ value: { in: urls } }, { value: null, defaultValue: { in: urls } }] },
        select: { value: true, defaultValue: true },
      })
    : [];
  const refCounts = new Map<string, number>();
  for (const f of referencedFields) {
    const url = f.value ?? f.defaultValue;
    refCounts.set(url, (refCounts.get(url) ?? 0) + 1);
  }

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Media library</h1>
        <p className="text-sm text-slate-500">
          {total} file{total === 1 ? "" : "s"}
          {pageCount > 1 ? ` \u00b7 page ${current} of ${pageCount}` : ""}
        </p>
      </div>
      <MediaGrid
        assets={assets.map((a) => ({
          id: a.id,
          url: a.url,
          filename: a.filename,
          width: a.width,
          height: a.height,
          createdAt: a.createdAt.toISOString(),
          references: refCounts.get(a.url) ?? 0,
        }))}
      />
      {pageCount > 1 ? (
        <nav className="mt-6 flex items-center gap-3 text-sm">
          {current > 1 ? (
            <Link href={`/admin/media?page=${current - 1}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
              Previous
            </Link>
          ) : null}
          {current < pageCount ? (
            <Link href={`/admin/media?page=${current + 1}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
