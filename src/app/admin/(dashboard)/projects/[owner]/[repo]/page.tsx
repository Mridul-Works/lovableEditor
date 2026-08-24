import Link from "next/link";
import { getGithubToken, getRepo, getTree } from "@/lib/github";
import { findPageFiles, suggestRoute } from "@/lib/importer/bundle";
import { db } from "@/lib/db";
import { RepoPageRow } from "@/components/admin/RepoPageRow";

export const dynamic = "force-dynamic";

export default async function RepoDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const token = await getGithubToken();
  if (!token) {
    return (
      <p className="text-sm text-slate-500">
        GitHub is not connected. <Link href="/admin/projects" className="text-indigo-600 underline">Connect it first.</Link>
      </p>
    );
  }

  let error: string | null = null;
  let pageFiles: string[] = [];
  let branch = "";
  try {
    const info = await getRepo(token, owner, repo);
    branch = info.defaultBranch;
    const tree = await getTree(token, owner, repo, branch);
    pageFiles = findPageFiles(tree);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not read the repository.";
  }

  const existing = await db.page.findMany({
    where: { sourceRepo: `${owner}/${repo}` },
    select: { id: true, route: true, sourcePath: true, status: true },
  });
  const existingByPath = new Map(existing.map((p) => [p.sourcePath, p]));

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/admin/projects" className="text-sm text-slate-500 hover:underline">← All projects</Link>
        <h1 className="mt-1 text-2xl font-bold">
          {owner}/<span className="text-indigo-700">{repo}</span>
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">Branch: <code className="rounded bg-slate-100 px-1">{branch || "?"}</code></p>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : pageFiles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No page files found (looked for <code>src/pages/*.tsx</code>, <code>src/routes/*.tsx</code>{" "}
          and <code>src/App.tsx</code>). This doesn&apos;t look like a Lovable project export.
        </div>
      ) : (
        <div className="space-y-3">
          {pageFiles.map((pagePath) => {
            const imported = existingByPath.get(pagePath);
            return (
              <RepoPageRow
                key={pagePath}
                owner={owner}
                repo={repo}
                pagePath={pagePath}
                suggestedRoute={suggestRoute(pagePath)}
                imported={imported ? { id: imported.id, route: imported.route, status: imported.status } : null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
