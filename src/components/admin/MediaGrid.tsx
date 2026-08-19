"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteMediaAction, uploadMediaAction } from "@/lib/actions";

type AssetRow = {
  id: string;
  url: string;
  filename: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  references: number;
};

export function MediaGrid({ assets }: { assets: AssetRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AssetRow | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadMediaAction(fd);
    setUploading(false);
    if (!result.ok) setError(result.error ?? "Upload failed.");
    router.refresh();
  };

  const remove = (asset: AssetRow, force: boolean) =>
    startTransition(async () => {
      const result = await deleteMediaAction(asset.id, force);
      if (!result.ok && result.referenced) {
        setError(`"${asset.filename}" is used by ${result.referenced} field(s). Delete anyway to leave those fields with a broken image.`);
        return; // keep the confirm dialog open for force delete
      }
      setConfirmDelete(null);
      setError(null);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
        {uploading ? "Uploading..." : "Upload image"}
        <input
          type="file"
          className="hidden"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </label>

      {error ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      {assets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
          No images uploaded yet.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {assets.map((a) => (
            <div key={a.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.filename} className="h-32 w-full bg-slate-50 object-cover" />
              <div className="p-3 text-xs">
                <p className="truncate font-medium text-slate-800" title={a.filename}>{a.filename}</p>
                <p className="mt-0.5 text-slate-500">
                  {a.width && a.height ? `${a.width}×${a.height} · ` : ""}
                  {new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className={a.references > 0 ? "text-emerald-600" : "text-slate-400"}>
                    {a.references > 0 ? `Used by ${a.references} field${a.references === 1 ? "" : "s"}` : "Unused"}
                  </span>
                  <button
                    onClick={() => { setConfirmDelete(a); setError(null); }}
                    className="font-semibold text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-6" onClick={() => setConfirmDelete(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Delete “{confirmDelete.filename}”?</h3>
            <p className="mt-2 text-sm text-slate-600">
              {confirmDelete.references > 0
                ? `This image is referenced by ${confirmDelete.references} content field${confirmDelete.references === 1 ? "" : "s"}. Deleting it will leave those fields pointing at a missing file.`
                : "This image is not referenced by any content field."}
            </p>
            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => remove(confirmDelete, confirmDelete.references > 0)}
                disabled={pending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {pending ? "Deleting..." : confirmDelete.references > 0 ? "Delete anyway" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
