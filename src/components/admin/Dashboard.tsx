"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { dashboardQueryKey, type DashboardData, type DashboardProject } from "@/lib/dashboard-types";
import { PageRowActions } from "./PageRowActions";
import { PageTitle } from "./PageTitle";
import { useImportQueue, type QueueItem } from "./useImportQueue";

// The admin home. Everything in one place: connected Lovable projects with
// GitHub's current head and how far each page is behind it, totals, and the
// page list with sync state and import quality. Data comes from TanStack
// Query — seeded by the server, refreshed every few minutes and on demand —
// so the GitHub status shown is the real one, not a snapshot from page load.

const POLL_MS = 5 * 60_000;

async function fetchDashboard(refresh: boolean): Promise<DashboardData> {
  const res = await fetch(`/api/admin/dashboard${refresh ? "?refresh=1" : ""}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Dashboard request failed (${res.status})`);
  return res.json() as Promise<DashboardData>;
}

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function Dashboard({ initial }: { initial: DashboardData }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [forceRefresh, setForceRefresh] = useState(false);
  const query = useQuery({
    queryKey: dashboardQueryKey,
    queryFn: () => fetchDashboard(forceRefresh),
    initialData: initial,
    // The server stamped the data; deriving the age from that keeps render pure.
    initialDataUpdatedAt: new Date(initial.fetchedAt).getTime(),
    refetchInterval: POLL_MS,
    staleTime: POLL_MS,
  });
  const data = query.data;

  const refreshNow = async () => {
    setForceRefresh(true);
    await qc.invalidateQueries({ queryKey: dashboardQueryKey });
    setForceRefresh(false);
  };

  const queue = useImportQueue(() => {
    void qc.invalidateQueries({ queryKey: dashboardQueryKey });
    router.refresh();
  });

  // ---- page list filters ---------------------------------------------------
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "PUBLISHED" | "DRAFT" | "behind" | "placeholders">("all");
  const [search, setSearch] = useState("");
  const pages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.pages.filter((p) => {
      if (projectFilter !== "all" && (p.sourceRepo ?? "paste") !== projectFilter) return false;
      if (statusFilter === "PUBLISHED" && p.status !== "PUBLISHED") return false;
      if (statusFilter === "DRAFT" && p.status !== "DRAFT") return false;
      if (statusFilter === "behind" && p.upToDate !== false) return false;
      if (statusFilter === "placeholders" && p.placeholders === 0) return false;
      if (q && !p.route.toLowerCase().includes(q) && !p.title.toLowerCase().includes(q) && !(p.sourcePath ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.pages, projectFilter, statusFilter, search]);

  const { stats } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <PageTitle lead="Site" accent="dashboard" />
          <p className="mt-3 text-xs text-neutral-500">
            {data.github.connected ? "GitHub connected" : "GitHub not connected"} · checked {ago(data.fetchedAt)}
            {query.isFetching ? " · refreshing…" : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm font-medium">
          <button
            type="button"
            onClick={() => void refreshNow()}
            disabled={query.isFetching}
            className="rounded-full border border-neutral-300 bg-white px-3 py-2 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {query.isFetching ? "Checking GitHub…" : "Check GitHub now"}
          </button>
          <Link href="/admin/projects" className="rounded-full border border-neutral-300 bg-white px-3 py-2 text-neutral-700 hover:bg-neutral-50">
            Lovable projects
          </Link>
          <Link href="/admin/import" className="rounded-full bg-ink px-4 py-2 text-white hover:bg-coal">
            Import page
          </Link>
        </div>
      </div>

      {data.github.error ? (
        <p className="rounded-xl bg-alert/10 px-4 py-3 text-sm text-alert">{data.github.error}</p>
      ) : null}
      {query.error ? (
        <p className="rounded-xl bg-alert/10 px-4 py-3 text-sm text-alert">{query.error.message}</p>
      ) : null}

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Pages" value={stats.pages} />
        <Stat label="Published" value={stats.published} tone="emerald" />
        <Stat label="Drafts" value={stats.drafts} tone={stats.drafts > 0 ? "amber" : undefined} />
        <Stat label="Behind GitHub" value={stats.behind} tone={stats.behind > 0 ? "amber" : "emerald"} hint={stats.behind > 0 ? "sync to update" : "all current"} />
        <Stat label="Placeholder images" value={stats.placeholders} tone={stats.placeholders > 0 ? "amber" : "emerald"} hint={stats.placeholders > 0 ? "upload in editor" : "none"} />
        <Stat label="Editable fields" value={stats.fields} />
        <Stat label="Media files" value={stats.media} />
      </div>

      {/* Projects */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-neutral-500">Lovable projects</h2>
        {data.projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
            No project imported yet. <Link href="/admin/projects" className="text-leaf underline">Browse your Lovable projects</Link> to import one.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.projects.map((p) => (
              <ProjectCard key={p.fullName} project={p} queue={queue} />
            ))}
          </div>
        )}
      </section>

      {/* Pages */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-500">Pages</h2>
          <span className="text-xs text-neutral-400">{pages.length} of {data.pages.length}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search route, title or file…"
              className="w-56 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 outline-none focus:border-ink"
            />
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="rounded-full border border-neutral-300 bg-white px-2 py-1.5"
            >
              <option value="all">All sources</option>
              {data.projects.map((p) => <option key={p.fullName} value={p.fullName}>{p.repo}</option>)}
              {data.pages.some((p) => !p.sourceRepo) ? <option value="paste">Pasted</option> : null}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="rounded-full border border-neutral-300 bg-white px-2 py-1.5"
            >
              <option value="all">Any state</option>
              <option value="PUBLISHED">Published</option>
              <option value="DRAFT">Draft</option>
              <option value="behind">Behind GitHub</option>
              <option value="placeholders">Has placeholder images</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3 whitespace-nowrap">Sync</th>
                <th className="px-4 py-3 whitespace-nowrap">State</th>
                <th className="px-4 py-3 text-right">Fields</th>
                <th className="px-4 py-3 whitespace-nowrap">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pages.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-neutral-500">No pages match these filters.</td></tr>
              ) : pages.map((page) => (
                <tr key={page.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="min-w-64 max-w-80 px-4 py-2.5 font-mono text-xs text-neutral-900">
                    {/* Long programme routes wrap at a slash, never mid-word. */}
                    <Link href={`/admin/pages/${page.id}`} className="hover:underline">
                      {page.route.split("/").map((part, i) => (i === 0 ? null : <span key={i}><wbr />/{part}</span>))}
                      {page.route === "/" ? "/" : null}
                    </Link>
                  </td>
                  <td className="max-w-48 truncate px-4 py-2.5" title={page.title}>{page.title}</td>
                  <td className="max-w-44 truncate px-4 py-2.5 text-xs text-neutral-500" title={page.sourcePath ?? ""}>
                    {page.sourceRepo ? (
                      <>{page.sourceRepo.split("/")[1]} <span className="text-neutral-400">· {page.sourcePath?.replace(/^src\/(routes|pages)\//, "")}</span></>
                    ) : "Pasted"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {page.upToDate === null ? (
                      <span className="text-xs text-neutral-400">—</span>
                    ) : page.upToDate ? (
                      <Badge tone="slate">up to date</Badge>
                    ) : (
                      <Badge tone="amber">behind</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <Badge tone={page.status === "PUBLISHED" ? "emerald" : "amber"}>{page.status === "PUBLISHED" ? "Published" : "Draft"}</Badge>
                      {page.placeholders > 0 ? (
                        <Badge tone="amber" title="Image fields still showing the import placeholder">{page.placeholders} placeholder{page.placeholders === 1 ? "" : "s"}</Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{page.fields}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500" title={new Date(page.updatedAt).toLocaleString()}>{ago(page.updatedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <PageRowActions pageId={page.id} route={page.route} status={page.status} hasGithubSource={page.sourceRepo !== null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: number; tone?: "emerald" | "amber"; hint?: string }) {
  const color = tone === "emerald" ? "text-leaf" : tone === "amber" ? "text-ember-ink" : "text-neutral-900";
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-1 text-3xl font-light tabular-nums tracking-tight ${color}`}>{value.toLocaleString()}</p>
      {hint ? <p className="text-[11px] text-neutral-400">{hint}</p> : null}
    </div>
  );
}

function Badge({ children, tone, title }: { children: React.ReactNode; tone: "slate" | "emerald" | "amber"; title?: string }) {
  const cls = tone === "emerald" ? "bg-mint text-leaf" : tone === "amber" ? "bg-ember/15 text-ember-ink" : "bg-neutral-100 text-neutral-500";
  return <span title={title} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}

function ProjectCard({ project, queue }: { project: DashboardProject; queue: ReturnType<typeof useImportQueue> }) {
  const toItems = (list: Array<{ pagePath: string; route: string }>): QueueItem[] =>
    list.map((l) => ({ owner: project.owner, repo: project.repo, pagePath: l.pagePath, route: l.route }));
  const mine = [...project.missing, ...project.outdated].map((l) => toItems([l])[0]);
  const active = mine.filter((i) => queue.stateOf(i));
  const finished = active.filter((i) => { const s = queue.stateOf(i); return s?.status === "done" || s?.status === "error"; }).length;
  const failed = active.filter((i) => queue.stateOf(i)?.status === "error");
  const allCurrent = project.pageFiles !== null && project.missing.length === 0 && project.outdated.length === 0;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/admin/projects/${project.owner}/${project.repo}`} className="font-semibold text-neutral-900 hover:text-leaf">
            {project.owner}/<span className="text-leaf">{project.repo}</span>
          </Link>
          <p className="mt-0.5 text-xs text-neutral-500">
            {project.error ? (
              <span className="text-alert">{project.error}</span>
            ) : (
              <>
                <code className="rounded bg-neutral-100 px-1">{project.branch}</code> at{" "}
                {project.htmlUrl && project.head ? (
                  <a href={`${project.htmlUrl}/commit/${project.head}`} target="_blank" rel="noreferrer" className="font-mono hover:underline">{project.head.slice(0, 7)}</a>
                ) : <span className="font-mono">{project.head?.slice(0, 7) ?? "?"}</span>}
                {" "}· pushed {ago(project.pushedAt)} · last synced {ago(project.lastSyncedAt)}
              </>
            )}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${allCurrent ? "bg-mint text-leaf" : "bg-ember/15 text-ember-ink"}`}>
          {project.pageFiles === null ? "GitHub unavailable" : allCurrent ? "Fully synced" : `${project.missing.length + project.outdated.length} to sync`}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
        <Cell label="Imported" value={`${project.imported}${project.pageFiles !== null ? ` / ${project.pageFiles}` : ""}`} />
        <Cell label="Published" value={String(project.published)} />
        <Cell label="Missing" value={String(project.missing.length)} warn={project.missing.length > 0} />
        <Cell label="Behind" value={String(project.outdated.length)} warn={project.outdated.length > 0} />
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
        {project.missing.length > 0 ? (
          <button type="button" disabled={queue.running} onClick={() => void queue.run(toItems(project.missing), true)} className="rounded-full bg-ink px-3 py-1.5 text-white hover:bg-coal disabled:opacity-50">
            Import {project.missing.length} missing
          </button>
        ) : null}
        {project.outdated.length > 0 ? (
          <button type="button" disabled={queue.running} onClick={() => void queue.run(toItems(project.outdated), true)} className={`rounded-full px-3 py-1.5 disabled:opacity-50 ${project.missing.length > 0 ? "border border-neutral-300 text-neutral-700 hover:bg-neutral-50" : "bg-ink text-white hover:bg-coal"}`}>
            Sync {project.outdated.length} outdated
          </button>
        ) : null}
        {queue.running && active.length > 0 ? (
          <button type="button" onClick={queue.stop} className="rounded-full border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:bg-neutral-50">Stop</button>
        ) : null}
        <Link href={`/admin/projects/${project.owner}/${project.repo}`} className="ml-auto text-leaf hover:underline">All pages →</Link>
      </div>

      {active.length > 0 ? (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-xs text-neutral-600">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <div className={`h-full rounded-full ${failed.length ? "bg-ember" : "bg-ink"}`} style={{ width: `${Math.round((finished / active.length) * 100)}%` }} />
            </div>
            <span className="tabular-nums" data-sync-progress>{finished} / {active.length}{failed.length ? ` · ${failed.length} failed` : ""}{!queue.running && finished === active.length ? " · done" : ""}</span>
          </div>
          {failed.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs text-alert">
              {failed.map((i) => { const s = queue.stateOf(i); return <li key={i.pagePath}><code>{i.route}</code> — {s && "detail" in s ? s.detail : ""}</li>; })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Cell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-neutral-50 px-2 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className={`text-base font-bold tabular-nums ${warn ? "text-ember-ink" : "text-neutral-800"}`}>{value}</dd>
    </div>
  );
}
