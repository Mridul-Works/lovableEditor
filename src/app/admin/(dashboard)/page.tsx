import Link from "next/link";
import { db } from "@/lib/db";
import { PageRowActions } from "@/components/admin/PageRowActions";

export const dynamic = "force-dynamic";

export default async function PagesListPage() {
  const pages = await db.page.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { fields: true } } },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pages</h1>
        <Link
          href="/admin/import"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Import page
        </Link>
      </div>

      {pages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
          No pages yet. <Link href="/admin/import" className="text-indigo-600 underline">Import your first page</Link> from Lovable.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Fields</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-900">{page.route}</td>
                  <td className="max-w-64 truncate px-4 py-3">{page.title}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        page.status === "PUBLISHED"
                          ? "rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700"
                          : "rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700"
                      }
                    >
                      {page.status === "PUBLISHED" ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{page._count.fields}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {page.updatedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PageRowActions
                      pageId={page.id}
                      route={page.route}
                      status={page.status as "DRAFT" | "PUBLISHED"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
