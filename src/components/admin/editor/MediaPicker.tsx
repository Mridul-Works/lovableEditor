"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { uploadMediaAction } from "@/lib/actions";
import { queryKeys, type MediaPageResponse } from "@/lib/editor-types";

// Media library modal. Pages of assets stream in through an infinite query,
// filtered server-side by kind (image/video) and filename. Uploading from
// here drops the new file straight into the field that opened the picker.

async function fetchMedia(kind: "image" | "video", q: string, cursor: string | null): Promise<MediaPageResponse> {
  const params = new URLSearchParams({ kind, q });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/admin/media?${params}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Media library request failed (${res.status})`);
  return res.json() as Promise<MediaPageResponse>;
}

export const ACCEPT_IMAGE = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml";
export const ACCEPT_VIDEO = "video/mp4,video/webm,video/quicktime";

export function useUpload(onDone: (url: string) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadMediaAction(fd);
      if (!result.ok || !result.asset) throw new Error(result.error ?? "Upload failed.");
      return result.asset.url;
    },
    onSuccess: (url) => {
      onDone(url);
      void qc.invalidateQueries({ queryKey: ["media"] });
    },
  });
}

export function MediaPicker({
  kind,
  onSelect,
  onClose,
}: {
  kind: "image" | "video";
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const media = useInfiniteQuery({
    queryKey: queryKeys.media(kind, debounced),
    queryFn: ({ pageParam }) => fetchMedia(kind, debounced, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const upload = useUpload((url) => onSelect(url));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const assets = media.data?.pages.flatMap((p) => p.assets) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Media library"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-3">
          <h3 className="text-base font-bold">Media library</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{kind}s</span>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by file name..."
            className="ml-auto w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
          />
          <label className="cursor-pointer rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500">
            {upload.isPending ? "Uploading..." : "Upload"}
            <input
              type="file"
              className="hidden"
              accept={kind === "video" ? ACCEPT_VIDEO : ACCEPT_IMAGE}
              disabled={upload.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = "";
              }}
            />
          </label>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-900">Close</button>
        </div>

        {upload.error ? (
          <p className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">{upload.error.message}</p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {media.isPending ? (
            <p className="py-16 text-center text-sm text-slate-500">Loading...</p>
          ) : media.isError ? (
            <p className="py-16 text-center text-sm text-red-600">{media.error.message}</p>
          ) : assets.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-500">
              {debounced ? "Nothing matches that search." : `No ${kind}s uploaded yet. Upload one above.`}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {assets.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onSelect(a.url)}
                  title={a.filename}
                  className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200"
                >
                  {kind === "video" ? (
                    <video src={a.url} muted preload="metadata" className="h-24 w-full bg-black object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.filename} loading="lazy" className="h-24 w-full object-cover" />
                  )}
                  <span className="block truncate px-2 py-1 text-[11px] text-slate-500">{a.filename}</span>
                </button>
              ))}
            </div>
          )}
          {media.hasNextPage ? (
            <div className="mt-4 text-center">
              <button
                onClick={() => void media.fetchNextPage()}
                disabled={media.isFetchingNextPage}
                className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {media.isFetchingNextPage ? "Loading..." : "Load more"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
