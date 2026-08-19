import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import type { TreeNode } from "@/lib/tree";

export const PAGE_STATUS = { DRAFT: "DRAFT", PUBLISHED: "PUBLISHED" } as const;

export type PageWithFields = NonNullable<Awaited<ReturnType<typeof fetchPage>>>;

function fetchPage(route: string) {
  return db.page.findUnique({
    where: { route },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
}

export function pageCacheTag(route: string) {
  return `page:${route}`;
}

/**
 * Cached read used for public traffic. Invalidated by revalidateTag on every
 * content save / import / publish, so edits are live immediately.
 */
export function getPageCached(route: string) {
  return unstable_cache(() => fetchPage(route), ["page-data", route], {
    tags: [pageCacheTag(route)],
  })();
}

/** Uncached read for admins (drafts, edit mode). Deduped per request. */
export const getPageFresh = cache(fetchPage);

/** field key → current value (edited value, falling back to the import default). */
export function fieldValues(page: PageWithFields): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of page.fields) {
    if (f.orphaned) continue;
    values[f.key] = f.value ?? f.defaultValue;
  }
  return values;
}

export function pageTree(page: PageWithFields): TreeNode[] {
  return page.tree as unknown as TreeNode[];
}
