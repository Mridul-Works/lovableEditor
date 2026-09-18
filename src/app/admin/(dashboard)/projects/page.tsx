import Link from "next/link";
import { GithubError, getGithubToken, listRepos, type Repo } from "@/lib/github";
import { ConnectGithubForm } from "@/components/admin/ConnectGithubForm";
import { DisconnectGithubButton } from "@/components/admin/DisconnectGithubButton";
import { db } from "@/lib/db";
import { PageTitle } from "@/components/admin/PageTitle";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const token = await getGithubToken();

  if (!token) {
    return (
      <div className="max-w-xl">
        <div className="mb-4"><PageTitle lead="Lovable" accent="projects" /></div>
        <p className="mb-6 text-sm text-neutral-500">
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
        <div className="mb-6"><PageTitle lead="Lovable" accent="projects" /></div>
        <p className="mb-6 rounded-xl bg-alert/10 px-4 py-3 text-sm text-alert">{error}</p>
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
          <PageTitle lead="Lovable" accent="projects" sub="Repositories on the connected GitHub account, most recently updated first." />
        </div>
        <DisconnectGithubButton />
      </div>

      {repos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-12 text-center text-neutral-500">
          No repositories found. In Lovable, use the GitHub button → Create repository, then refresh.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {repos.map((r) => (
            <Link
              key={r.fullName}
              href={`/admin/projects/${r.owner}/${r.name}`}
              className="group rounded-2xl border border-neutral-200 bg-white p-4 hover:border-ink hover:ring-2 hover:ring-sun/50"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-neutral-900 group-hover:text-leaf">{r.name}</span>
                {r.private ? (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">private</span>
                ) : null}
                {importedRepos.has(r.fullName) ? (
                  <span className="rounded-full bg-mint px-2 py-0.5 text-[10px] font-semibold text-leaf">imported</span>
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{r.description ?? "No description"}</p>
              <p className="mt-2 text-[11px] text-neutral-400">
                Updated {new Date(r.pushedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
