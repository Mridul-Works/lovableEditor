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
  imported: { id: string; route: string; status: string; upToDate: boolean } | null;
}) {
  const [state, formAction, pending] = useActionState<GithubImportState, FormData>(
    importFromGithubAction,
    {},
  );

  const done = state.pageId ? state : null;
  const current = done ? { id: done.pageId!, route: done.route!, status: "", upToDate: true } : imported;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded bg-neutral-100 px-2 py-1 text-xs">{pagePath}</code>
        {current ? (
          <>
            <span className="rounded-full bg-mint px-2 py-0.5 text-[10px] font-semibold text-leaf">
              imported → {current.route}
            </span>
            <span
              className={
                current.upToDate
                  ? "rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500"
                  : "rounded-full bg-ember/15 px-2 py-0.5 text-[10px] font-semibold text-ember-ink"
              }
              title={current.upToDate ? "Synced at the latest push" : "GitHub has newer commits than this page's last sync"}
            >
              {current.upToDate ? "up to date" : "behind GitHub"}
            </span>
            <span className="ml-auto flex items-center gap-3 text-xs font-medium">
              <Link href={`/admin/pages/${current.id}`} className="text-leaf hover:underline">Open editor</Link>
              <a href={current.route} target="_blank" rel="noreferrer" className="text-neutral-600 hover:underline">View</a>
            </span>
          </>
        ) : null}
      </div>

      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="owner" value={owner} />
        <input type="hidden" name="repo" value={repo} />
        <input type="hidden" name="pagePath" value={pagePath} />
        <label className="flex items-center gap-2 text-xs font-medium text-neutral-600">
          Route
          <input
            name="route"
            defaultValue={current?.route ?? suggestedRoute}
            className="w-44 rounded-lg border border-neutral-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-ink"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-white hover:bg-coal disabled:opacity-50"
        >
          {pending ? "Importing..." : current ? "Sync from GitHub" : "Import"}
        </button>
      </form>

      {state.error ? <p className="mt-2 text-xs text-alert">{state.error}</p> : null}
      {done?.report ? (
        <div className="mt-3 rounded-xl bg-mint/60 px-4 py-3 text-xs text-leaf">
          <p className="font-semibold">
            {done.reimported ? "Synced" : "Imported"} → {done.route} · {done.report.textFields} text fields ·{" "}
            {done.report.imageFields} images · {done.report.linkFields ?? 0} links · {done.filesBundled} files bundled ·{" "}
            {done.assetsUploaded} assets uploaded
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
