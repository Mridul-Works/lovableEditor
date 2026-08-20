"use client";

import Link from "next/link";
import { useActionState } from "react";
import { importFromGithubAction, type GithubImportState } from "@/lib/actions";

export function RepoPageRow({
  owner,
  repo,
  pagePath,
  suggestedRoute,
  imported,
}: {
  owner: string;
  repo: string;
  pagePath: string;
  suggestedRoute: string;
  imported: { id: string; route: string; status: string } | null;
}) {
  const [state, formAction, pending] = useActionState<GithubImportState, FormData>(
    importFromGithubAction,
    {},
  );

  const done = state.pageId ? state : null;
  const current = done ? { id: done.pageId!, route: done.route!, status: "" } : imported;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded bg-slate-100 px-2 py-1 text-xs">{pagePath}</code>
        {current ? (
          <>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              imported → {current.route}
            </span>
            <span className="ml-auto flex items-center gap-3 text-xs font-medium">
              <Link href={`/admin/pages/${current.id}`} className="text-indigo-600 hover:underline">Open editor</Link>
              <a href={current.route} target="_blank" rel="noreferrer" className="text-slate-600 hover:underline">View</a>
            </span>
          </>
        ) : null}
      </div>

      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="owner" value={owner} />
        <input type="hidden" name="repo" value={repo} />
        <input type="hidden" name="pagePath" value={pagePath} />
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          Route
          <input
            name="route"
            defaultValue={current?.route ?? suggestedRoute}
            className="w-44 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-indigo-500"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {pending ? "Importing..." : current ? "Sync from GitHub" : "Import"}
        </button>
      </form>

      {state.error ? <p className="mt-2 text-xs text-red-600">{state.error}</p> : null}
      {done?.report ? (
        <div className="mt-3 rounded-lg bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
          <p className="font-semibold">
            {done.reimported ? "Synced" : "Imported"} → {done.route} · {done.report.textFields} text fields ·{" "}
            {done.report.imageFields} images · {done.filesBundled} files bundled · {done.assetsUploaded} assets uploaded
            {done.report.merge
              ? ` · kept ${done.report.merge.kept} / added ${done.report.merge.added} / orphaned ${done.report.merge.orphaned}`
              : ""}
          </p>
          {done.report.notes.length > 0 ? (
            <ul className="mt-1 list-inside list-disc">
              {done.report.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          ) : null}
          <p className="mt-2">
            <Link href={`/admin/pages/${done.pageId}`} className="font-semibold underline">Open editor</Link>
            <a href={done.route} target="_blank" rel="noreferrer" className="ml-3 font-semibold underline">View page</a>
          </p>
        </div>
      ) : null}
    </div>
  );
}
