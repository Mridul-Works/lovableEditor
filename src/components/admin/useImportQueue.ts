"use client";

import { useRef, useState } from "react";

// A queue of page imports against /api/admin/github/import, a few in flight
// at once, with per-page status. Shared by the project screen and the
// dashboard so both sync the same way.

export type QueueItem = { owner: string; repo: string; pagePath: string; route: string };

export type ItemState =
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

export function useImportQueue(onFinished?: () => void) {
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  const key = (item: QueueItem) => `${item.owner}/${item.repo}:${item.pagePath}`;
  const set = (item: QueueItem, state: ItemState) => setItems((prev) => ({ ...prev, [key(item)]: state }));

  const importOne = async (item: QueueItem, publishNew: boolean) => {
    set(item, { status: "running" });
    try {
      const res = await fetch("/api/admin/github/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...item, publishNew }),
      });
      const data = (await res.json().catch(() => ({ error: `Server error (${res.status})` }))) as ImportResponse;
      if (data.error || !data.report) {
        set(item, { status: "error", detail: data.error ?? "Import failed." });
        return;
      }
      const r = data.report;
      const merge = r.merge ? ` · kept ${r.merge.kept}, added ${r.merge.added}, orphaned ${r.merge.orphaned}` : "";
      const verb = data.reimported ? "synced" : data.published ? "imported + published" : "imported as draft";
      set(item, { status: "done", detail: `${verb} · ${r.textFields} text, ${r.imageFields} images, ${r.linkFields ?? 0} links${merge}` });
    } catch (e) {
      set(item, { status: "error", detail: e instanceof Error ? e.message : "Network error." });
    }
  };

  const run = async (targets: QueueItem[], publishNew: boolean) => {
    if (running || targets.length === 0) return;
    stopRef.current = false;
    setRunning(true);
    setItems(Object.fromEntries(targets.map((t) => [key(t), { status: "queued" } as ItemState])));

    // The first page warms the repo snapshot; the rest share it.
    const queue = [...targets];
    const first = queue.shift();
    if (first) await importOne(first, publishNew);
    const worker = async () => {
      while (!stopRef.current) {
        const next = queue.shift();
        if (!next) return;
        await importOne(next, publishNew);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Anything still queued was skipped by Stop.
    setItems((prev) => {
      const next = { ...prev };
      for (const t of queue) delete next[key(t)];
      return next;
    });
    setRunning(false);
    onFinished?.();
  };

  const stop = () => { stopRef.current = true; };
  const states = Object.values(items);
  const summary = {
    total: states.length,
    finished: states.filter((s) => s.status === "done" || s.status === "error").length,
    failed: states.filter((s) => s.status === "error").length,
  };
  const stateOf = (item: QueueItem): ItemState | undefined => items[key(item)];

  return { run, stop, running, items, stateOf, summary };
}
