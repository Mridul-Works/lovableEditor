import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { EditorForm } from "@/components/admin/EditorForm";

export const dynamic = "force-dynamic";

export default async function PageEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({
    where: { id },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!page) notFound();

  const assets = await db.mediaAsset.findMany({ orderBy: { createdAt: "desc" }, take: 200 });

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{page.title}</h1>
          <p className="mt-0.5 font-mono text-sm text-slate-500">{page.route}</p>
        </div>
        <div className="flex items-center gap-3 text-sm font-medium">
          <span
            className={
              page.status === "PUBLISHED"
                ? "rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700"
                : "rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700"
            }
          >
            {page.status === "PUBLISHED" ? "Published" : "Draft"}
          </span>
          <a href={page.route} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
            View live
          </a>
          <a href={`${page.route}?edit=1`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
            Edit on page
          </a>
          <Link href="/admin" className="text-slate-500 hover:underline">Back</Link>
        </div>
      </div>

      <EditorForm
        pageId={page.id}
        route={page.route}
        fields={page.fields.map((f) => ({
          id: f.id,
          key: f.key,
          type: f.type as "TEXT" | "IMAGE",
          label: f.label,
          section: f.section,
          defaultValue: f.defaultValue,
          value: f.value,
          orphaned: f.orphaned,
          sortOrder: f.sortOrder,
        }))}
        assets={assets.map((a) => ({
          id: a.id, url: a.url, filename: a.filename, width: a.width, height: a.height,
        }))}
      />
    </div>
  );
}
