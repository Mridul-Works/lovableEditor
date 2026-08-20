import Link from "next/link";
import { GithubError, getGithubToken, listRepos, type Repo } from "@/lib/github";
import { ConnectGithubForm } from "@/components/admin/ConnectGithubForm";
import { DisconnectGithubButton } from "@/components/admin/DisconnectGithubButton";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const token = await getGithubToken();

  if (!token) {
    return (
      <div className="max-w-xl">
        <h1 className="mb-1 text-2xl font-bold">Lovable projects</h1>
        <p className="mb-6 text-sm text-slate-500">
          Lovable syncs every project to GitHub (free plan included). Connect the GitHub account
          Lovable pushes to, and you can browse your projects and import pages with one click.
        </p>
        <ConnectGithubForm />
      </div>
    );
  }

  let repos: Repo[] = [];
  let error: string | null = null;
  try {
    repos = await listRepos(token);
  } catch (e) {
    error = e instanceof GithubError && e.status === 401
      ? "GitHub rejected the stored token — reconnect below."
      : e instanceof Error ? e.message : "Could not reach GitHub.";
  }

  if (error) {
    return (
      <div className="max-w-xl">
        <h1 className="mb-4 text-2xl font-bold">Lovable projects</h1>
        <p className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        <ConnectGithubForm />
      </div>
    );
  }

  const importedRepos = new Set(
    (await db.page.findMany({ where: { sourceRepo: { not: null } }, select: { sourceRepo: true } }))
      .map((p) => p.sourceRepo as string),
  );

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Lovable projects</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Repositories on the connected GitHub account, most recently updated first.
          </p>
        </div>
        <DisconnectGithubButton />
      </div>

      {repos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
          No repositories found. In Lovable, use the GitHub button → Create repository, then refresh.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {repos.map((r) => (
            <Link
              key={r.fullName}
              href={`/admin/projects/${r.owner}/${r.name}`}
              className="group rounded-xl border border-slate-200 bg-white p-4 hover:border-indigo-400 hover:ring-2 hover:ring-indigo-100"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900 group-hover:text-indigo-700">{r.name}</span>
                {r.private ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">private</span>
                ) : null}
                {importedRepos.has(r.fullName) ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">imported</span>
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{r.description ?? "No description"}</p>
              <p className="mt-2 text-[11px] text-slate-400">
                Updated {new Date(r.pushedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
