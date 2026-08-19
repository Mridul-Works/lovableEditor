import { db } from "@/lib/db";
import { MediaGrid } from "@/components/admin/MediaGrid";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const assets = await db.mediaAsset.findMany({ orderBy: { createdAt: "desc" } });

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
      <h1 className="mb-6 text-2xl font-bold">Media library</h1>
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
    </div>
  );
}
