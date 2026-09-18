import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { getGithubToken } from "@/lib/github";
import { pageCacheTag, PAGE_STATUS } from "@/lib/pages";
import type { ImportReport } from "@/lib/tree";
import { bundlePageFromRepo } from "./bundle";
import { importPageFromSource } from "./import-page";
import { getRepoContext } from "./snapshot";

// One page of a connected GitHub (Lovable) project → a page in the CMS. Shared
// by the per-row Import button, the per-page Sync button and the whole-project
// sync, so all three behave identically.

export type RepoPageImport = {
  owner: string;
  repo: string;
  pagePath: string;
  /** Already normalized. */
  route: string;
  /** Publish the page if this import creates it (existing pages keep their status). */
  publishNew?: boolean;
};

export type RepoPageResult = {
  error?: string;
  report?: ImportReport;
  pageId?: string;
  route?: string;
  reimported?: boolean;
  published?: boolean;
  filesBundled?: number;
  assetsUploaded?: number;
  commit?: string;
};

export async function importRepoPage(input: RepoPageImport): Promise<RepoPageResult> {
  const { owner, repo, pagePath, route } = input;
  const token = await getGithubToken();
  if (!token) return { error: "GitHub is not connected." };

  // A route belongs to one source. Importing a different file over it would
  // silently replace that page's content and detach it from its own repo.
  const occupant = await db.page.findUnique({
    where: { route },
    select: { sourceRepo: true, sourcePath: true },
  });
  const sourceRepo = `${owner}/${repo}`;
  if (occupant && (occupant.sourceRepo !== sourceRepo || occupant.sourcePath !== pagePath)) {
    const owner_ = occupant.sourceRepo ? `${occupant.sourceRepo} (${occupant.sourcePath})` : "a pasted page";
    return { error: `Route ${route} is already used by ${owner_}. Delete that page or pick another route.` };
  }

  const context = await getRepoContext(token, owner, repo);
  const bundle = await bundlePageFromRepo(
    { token, owner, repo, branch: context.branch },
    pagePath,
    context.tree,
    context.reader,
  );

  const outcome = await importPageFromSource({
    route,
    source: bundle.source,
    themeCss: bundle.themeCss,
    tailwindConfig: bundle.tailwindConfig,
    indexHtml: bundle.indexHtml,
    assetUrls: bundle.assetUrls,
    truncated: bundle.truncated,
    origin: { repo: sourceRepo, branch: context.branch, path: pagePath, commit: context.commit },
  });

  let published = false;
  if (input.publishNew && !outcome.reimported) {
    await db.page.update({ where: { id: outcome.pageId }, data: { status: PAGE_STATUS.PUBLISHED } });
    published = true;
  }

  revalidateTag(pageCacheTag(route), "max");
  revalidatePath(route);
  revalidatePath("/admin");
  revalidatePath(`/admin/pages/${outcome.pageId}`);
  revalidatePath(`/admin/projects/${owner}/${repo}`);

  return {
    report: outcome.report,
    pageId: outcome.pageId,
    route,
    reimported: outcome.reimported,
    published,
    filesBundled: bundle.filesBundled.length,
    assetsUploaded: bundle.assetsUploaded.length,
    commit: context.commit,
  };
}
