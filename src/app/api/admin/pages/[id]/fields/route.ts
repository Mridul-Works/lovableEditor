import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import type { PageFieldsResponse } from "@/lib/editor-types";
import { isFieldType } from "@/lib/tree";

// Field data for the admin editor. The page component seeds the editor's
// query cache with the same shape, and TanStack Query refetches from here
// after every save so what the admin sees is what the database holds.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const page = await db.page.findUnique({
    where: { id },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body: PageFieldsResponse = {
    page: {
      id: page.id,
      route: page.route,
      title: page.title,
      status: page.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
      sourceRepo: page.sourceRepo,
      updatedAt: page.updatedAt.toISOString(),
    },
    fields: page.fields.map((f) => ({
      id: f.id,
      key: f.key,
      type: isFieldType(f.type) ? f.type : "TEXT",
      label: f.label,
      section: f.section,
      defaultValue: f.defaultValue,
      value: f.value,
      orphaned: f.orphaned,
      sortOrder: f.sortOrder,
    })),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
