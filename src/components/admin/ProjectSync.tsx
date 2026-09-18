"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useImportQueue, type QueueItem } from "./useImportQueue";

// Whole-project sync. A Lovable project is a site, not a page: importing one
// route leaves every link to the others broken. This queues every page file
// in the repo — importing the missing ones, re-syncing the rest (admin edits
// survive a re-sync) — a few at a time, and reports each page as it lands.

export type ProjectPage = {
  pagePath: string;
  route: string;
  imported: boolean;
  /** Imported and last synced at the branch's current head commit. */
  upToDate: boolean;
};

export function ProjectSync({ owner, repo, pages }: { owner: string; repo: string; pages: ProjectPage[] }) {
  const router = useRouter();
  const [publishNew, setPublishNew] = useState(true);
  const queue = useImportQueue(() => router.refresh());

  const toItems = (list: ProjectPage[]): QueueItem[] => list.map((p) => ({ owner, repo, pagePath: p.pagePath, route: p.route }));
  const missing = pages.filter((p) => !p.imported);
  const outdated = pages.filter((p) => p.imported && !p.upToDate);
  const { total, finished, failed } = queue.summary;
  const touched = pages.filter((p) => queue.stateOf(toItems([p])[0]));

  const primary = "rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white hover:bg-coal";
  const secondary = "rounded-full border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50";

  return (
    <section className="mb-6 rounded-2xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-neutral-900">Sync entire project</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            {pages.length - missing.length} of {pages.length} pages imported
            {outdated.length > 0 ? `, ${outdated.length} behind the latest push` : ""}.{" "}
            {missing.length > 0
              ? "Links to pages that are not imported lead nowhere on this site."
              : outdated.length > 0
                ? "Sync to pull the latest design from GitHub; your edits are kept."
                : "Everything matches the latest push on GitHub."}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={publishNew}
            disabled={queue.running}
            onChange={(e) => setPublishNew(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-neutral-300"
          />
          Publish new pages
        </label>
        {queue.running ? (
          <button type="button" onClick={queue.stop} className={secondary}>Stop after current</button>
        ) : (
          <>
            {missing.length > 0 ? (
              <button type="button" onClick={() => void queue.run(toItems(missing), publishNew)} className={primary}>
                Import {missing.length} missing
              </button>
            ) : null}
            {outdated.length > 0 ? (
              <button type="button" onClick={() => void queue.run(toItems(outdated), publishNew)} className={missing.length > 0 ? secondary : primary}>
                Sync {outdated.length} outdated
              </button>
            ) : null}
            <button type="button" onClick={() => void queue.run(toItems(pages), publishNew)} className={secondary}>
              Sync all {pages.length}
            </button>
          </>
        )}
      </div>

      {total > 0 ? (
        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${failed > 0 ? "bg-ember" : "bg-ink"}`}
                style={{ width: `${Math.round((finished / total) * 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-medium tabular-nums text-neutral-600" data-sync-progress>
              {finished} / {total}
              {failed > 0 ? ` · ${failed} failed` : ""}
              {!queue.running && finished === total ? " · done" : ""}
            </span>
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
            {touched.map((p) => {
              const s = queue.stateOf(toItems([p])[0])!;
              const color =
                s.status === "done" ? "text-leaf" : s.status === "error" ? "text-alert" : s.status === "running" ? "text-leaf" : "text-neutral-400";
              return (
                <li key={p.pagePath} className="flex items-baseline gap-2">
                  <span className={`w-14 shrink-0 font-semibold ${color}`}>
                    {s.status === "done" ? "done" : s.status === "error" ? "failed" : s.status === "running" ? "syncing" : "queued"}
                  </span>
                  <code className="shrink-0 text-neutral-700">{p.route}</code>
                  {"detail" in s ? <span className="min-w-0 truncate text-neutral-500" title={s.detail}>{s.detail}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
