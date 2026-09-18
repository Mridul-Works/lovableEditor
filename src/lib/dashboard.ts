import "server-only";
import { db } from "@/lib/db";
import { getBranchHead, getGithubToken, getRepo, getTree, GithubError } from "@/lib/github";
import { findPageFiles, suggestRoute } from "@/lib/importer/bundle";
import type { DashboardData, DashboardPage, DashboardProject } from "@/lib/dashboard-types";

// Everything the admin dashboard shows, in one call: pages and their sync
// state, connected projects with GitHub's current head, and totals. GitHub
// is asked once per project per minute at most, so the dashboard can poll
// without touching the API rate limit.

type RepoHead = { branch: string; head: string; pushedAt: string; htmlUrl: string; pageFiles: string[] };
const HEAD_TTL_MS = 60_000;
const globalForHeads = globalThis as unknown as { repoHeadCache?: Map<string, { at: number; value: Promise<RepoHead> }> };
const headCache = globalForHeads.repoHeadCache ?? (globalForHeads.repoHeadCache = new Map());

async function repoHead(token: string, owner: string, repo: string, force: boolean): Promise<RepoHead> {
  const key = `${owner}/${repo}`;
  const hit = headCache.get(key);
  if (hit && !force && Date.now() - hit.at < HEAD_TTL_MS) return hit.value;
  const value = (async () => {
    const info = await getRepo(token, owner, repo);
    const head = await getBranchHead(token, owner, repo, info.defaultBranch);
    const tree = await getTree(token, owner, repo, head);
    return { branch: info.defaultBranch, head, pushedAt: info.pushedAt, htmlUrl: info.htmlUrl, pageFiles: findPageFiles(tree) };
  })();
  headCache.set(key, { at: Date.now(), value });
  value.catch(() => headCache.delete(key));
  return value;
}

export async function getDashboardData(options?: { refresh?: boolean }): Promise<DashboardData> {
  const [rows, placeholderRows, media, token] = await Promise.all([
    db.page.findMany({
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { fields: true } } },
      take: 500,
    }),
    db.field.groupBy({
      by: ["pageId"],
      where: { type: "IMAGE", value: null, defaultValue: { startsWith: "data:image/svg" }, orphaned: false },
      _count: { _all: true },
    }),
    db.mediaAsset.count(),
    getGithubToken(),
  ]);
  const placeholdersByPage = new Map(placeholderRows.map((r) => [r.pageId, r._count._all]));

  // One GitHub lookup per connected project, all in parallel.
  const repoNames = [...new Set(rows.map((p) => p.sourceRepo).filter((r): r is string => Boolean(r)))];
  const heads = new Map<string, RepoHead | { error: string }>();
  let githubError: string | null = null;
  if (token) {
    await Promise.all(
      repoNames.map(async (fullName) => {
        const [owner, repo] = fullName.split("/");
        try {
          heads.set(fullName, await repoHead(token, owner, repo, options?.refresh === true));
        } catch (e) {
          const message = e instanceof GithubError && e.status === 401
            ? "GitHub rejected the stored token — reconnect under Lovable projects."
            : e instanceof Error ? e.message : "Could not reach GitHub.";
          heads.set(fullName, { error: message });
          if (e instanceof GithubError && e.status === 401) githubError = message;
        }
      }),
    );
  }

  const pages: DashboardPage[] = rows.map((p) => {
    const head = p.sourceRepo ? heads.get(p.sourceRepo) : undefined;
    const upToDate = !p.sourceRepo ? null : head && "head" in head ? p.sourceCommit === head.head : null;
    return {
      id: p.id,
      route: p.route,
      title: p.title,
      status: p.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
      sourceRepo: p.sourceRepo,
      sourcePath: p.sourcePath,
      sourceCommit: p.sourceCommit,
      upToDate,
      fields: p._count.fields,
      placeholders: placeholdersByPage.get(p.id) ?? 0,
      updatedAt: p.updatedAt.toISOString(),
    };
  });

  const projects: DashboardProject[] = repoNames.map((fullName) => {
    const [owner, repo] = fullName.split("/");
    const own = pages.filter((p) => p.sourceRepo === fullName);
    const head = heads.get(fullName);
    const ok = head && "head" in head ? head : null;
    const byPath = new Map(own.map((p) => [p.sourcePath, p]));
    const missing = ok
      ? ok.pageFiles.filter((f) => !byPath.has(f)).map((f) => ({ pagePath: f, route: suggestRoute(f) }))
      : [];
    const outdated = own
      .filter((p) => p.upToDate === false && p.sourcePath)
      .map((p) => ({ pagePath: p.sourcePath!, route: p.route }));
    const lastSynced = own.reduce<string | null>((max, p) => (!max || p.updatedAt > max ? p.updatedAt : max), null);
    return {
      owner,
      repo,
      fullName,
      branch: ok?.branch ?? "",
      head: ok?.head ?? null,
      pushedAt: ok?.pushedAt ?? null,
      htmlUrl: ok?.htmlUrl ?? null,
      pageFiles: ok ? ok.pageFiles.length : null,
      imported: own.length,
      published: own.filter((p) => p.status === "PUBLISHED").length,
      behind: outdated.length,
      missing,
      outdated,
      lastSyncedAt: lastSynced,
      error: head && "error" in head ? head.error : token ? null : "GitHub is not connected.",
    };
  });

  return {
    fetchedAt: new Date().toISOString(),
    github: { connected: Boolean(token), error: githubError },
    stats: {
      pages: pages.length,
      published: pages.filter((p) => p.status === "PUBLISHED").length,
      drafts: pages.filter((p) => p.status !== "PUBLISHED").length,
      fields: pages.reduce((n, p) => n + p.fields, 0),
      media,
      placeholders: pages.reduce((n, p) => n + p.placeholders, 0),
      behind: pages.filter((p) => p.upToDate === false).length,
    },
    projects,
    pages,
  };
}
