"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deletePageAction, setPageStatusAction, syncPageAction } from "@/lib/actions";

export function PageRowActions({
  pageId,
  route,
  status,
  hasGithubSource = false,
}: {
  pageId: string;
  route: string;
  status: "DRAFT" | "PUBLISHED";
  hasGithubSource?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const sync = () =>
    startTransition(async () => {
      setSyncMessage(null);
      const result = await syncPageAction(pageId);
      setSyncMessage(result.error ?? (result.report?.merge
        ? `Synced: kept ${result.report.merge.kept}, added ${result.report.merge.added}, orphaned ${result.report.merge.orphaned}`
        : "Synced."));
      router.refresh();
    });

  const toggleStatus = () =>
    startTransition(async () => {
      await setPageStatusAction(pageId, status === "PUBLISHED" ? "DRAFT" : "PUBLISHED");
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      await deletePageAction(pageId);
      setConfirming(false);
      router.refresh();
    });

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="text-slate-600">Delete {route}?</span>
        <button onClick={remove} disabled={pending} className="font-semibold text-red-600 hover:underline disabled:opacity-50">
          {pending ? "Deleting..." : "Yes, delete"}
        </button>
        <button onClick={() => setConfirming(false)} className="text-slate-500 hover:underline">Cancel</button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-3 text-xs font-medium">
      {syncMessage ? <span className="text-slate-500">{syncMessage}</span> : null}
      <Link href={`/admin/pages/${pageId}`} className="text-indigo-600 hover:underline">Edit</Link>
      <a href={route} target="_blank" rel="noreferrer" className="text-slate-600 hover:underline">View</a>
      {hasGithubSource ? (
        <button onClick={sync} disabled={pending} className="text-indigo-600 hover:underline disabled:opacity-50">
          {pending ? "Syncing..." : "Sync"}
        </button>
      ) : null}
      <button onClick={toggleStatus} disabled={pending} className="text-slate-600 hover:underline disabled:opacity-50">
        {status === "PUBLISHED" ? "Unpublish" : "Publish"}
      </button>
      <button onClick={() => setConfirming(true)} className="text-red-600 hover:underline">Delete</button>
    </span>
  );
}
