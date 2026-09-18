"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

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

type ItemState =
  | { status: "idle" }
  | { status: "queued" }
  | { status: "running" }
  | { status: "done"; detail: string }
  | { status: "error"; detail: string };

type ImportResponse = {
  error?: string;
  reimported?: boolean;
  published?: boolean;
  report?: {
    textFields: number;
    imageFields: number;
    linkFields?: number;
    merge?: { kept: number; added: number; orphaned: number };
  };
};

const CONCURRENCY = 3;

export function ProjectSync({ owner, repo, pages }: { owner: string; repo: string; pages: ProjectPage[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [running, setRunning] = useState(false);
  const [publishNew, setPublishNew] = useState(true);
  const stopRef = useRef(false);

  const missing = pages.filter((p) => !p.imported);
  const outdated = pages.filter((p) => p.imported && !p.upToDate);
  const set = (pagePath: string, state: ItemState) => setItems((prev) => ({ ...prev, [pagePath]: state }));

  const importOne = async (page: ProjectPage) => {
    set(page.pagePath, { status: "running" });
    try {
      const res = await fetch("/api/admin/github/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ owner, repo, pagePath: page.pagePath, route: page.route, publishNew }),
      });
      const data = (await res.json().catch(() => ({ error: `Server error (${res.status})` }))) as ImportResponse;
      if (data.error || !data.report) {
        set(page.pagePath, { status: "error", detail: data.error ?? "Import failed." });
        return;
      }
      const r = data.report;
      const merge = r.merge ? ` · kept ${r.merge.kept}, added ${r.merge.added}, orphaned ${r.merge.orphaned}` : "";
      set(page.pagePath, {
        status: "done",
        detail: `${data.reimported ? "synced" : data.published ? "imported + published" : "imported as draft"} · ${r.textFields} text, ${r.imageFields} images, ${r.linkFields ?? 0} links${merge}`,
      });
    } catch (e) {
      set(page.pagePath, { status: "error", detail: e instanceof Error ? e.message : "Network error." });
    }
  };

  const run = async (targets: ProjectPage[]) => {
    if (running || targets.length === 0) return;
    stopRef.current = false;
    setRunning(true);
    setItems(Object.fromEntries(targets.map((p) => [p.pagePath, { status: "queued" } as ItemState])));

    // The first page warms the repo snapshot; the rest then share it instead
    // of each downloading the archive.
    const queue = [...targets];
    const first = queue.shift();
    if (first) await importOne(first);

    const worker = async () => {
      while (!stopRef.current) {
        const next = queue.shift();
        if (!next) return;
        await importOne(next);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    for (const p of queue) set(p.pagePath, { status: "idle" }); // stopped early
    setRunning(false);
    router.refresh();
  };

  const states = Object.values(items);
  const total = states.length;
  const finished = states.filter((s) => s.status === "done" || s.status === "error").length;
  const failed = states.filter((s) => s.status === "error").length;
  const touched = pages.filter((p) => items[p.pagePath] && items[p.pagePath].status !== "idle");

  return (
    <section className="mb-6 rounded-xl border border-indigo-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-900">Sync entire project</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {pages.length - missing.length} of {pages.length} pages imported
            {outdated.length > 0 ? `, ${outdated.length} behind the latest push` : ""}.{" "}
            {missing.length > 0
              ? "Links to pages that are not imported lead nowhere on this site."
              : outdated.length > 0
                ? "Sync to pull the latest design from GitHub; your edits are kept."
                : "Everything matches the latest push on GitHub."}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={publishNew}
            disabled={running}
            onChange={(e) => setPublishNew(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Publish new pages
        </label>
        {running ? (
          <button
            type="button"
            onClick={() => { stopRef.current = true; }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Stop after current
          </button>
        ) : (
          <>
            {missing.length > 0 ? (
              <button
                type="button"
                onClick={() => void run(missing)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                Import {missing.length} missing
              </button>
            ) : null}
            {outdated.length > 0 ? (
              <button
                type="button"
                onClick={() => void run(outdated)}
                className={
                  missing.length > 0
                    ? "rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    : "rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
                }
              >
                Sync {outdated.length} outdated
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void run(pages)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Sync all {pages.length}
            </button>
          </>
        )}
      </div>

      {total > 0 ? (
        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${failed > 0 ? "bg-amber-500" : "bg-indigo-500"}`}
                style={{ width: `${total === 0 ? 0 : Math.round((finished / total) * 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-medium tabular-nums text-slate-600" data-sync-progress>
              {finished} / {total}
              {failed > 0 ? ` · ${failed} failed` : ""}
              {!running && finished === total ? " · done" : ""}
            </span>
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
            {touched.map((p) => {
              const s = items[p.pagePath];
              return (
                <li key={p.pagePath} className="flex items-baseline gap-2">
                  <span
                    className={
                      s.status === "done" ? "w-14 shrink-0 font-semibold text-emerald-600"
                      : s.status === "error" ? "w-14 shrink-0 font-semibold text-red-600"
                      : s.status === "running" ? "w-14 shrink-0 font-semibold text-indigo-600"
                      : "w-14 shrink-0 text-slate-400"
                    }
                  >
                    {s.status === "done" ? "done" : s.status === "error" ? "failed" : s.status === "running" ? "syncing" : "queued"}
                  </span>
                  <code className="shrink-0 text-slate-700">{p.route}</code>
                  {"detail" in s ? <span className="min-w-0 truncate text-slate-500" title={s.detail}>{s.detail}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
