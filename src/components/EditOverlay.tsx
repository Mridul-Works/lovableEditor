"use client";

import { useEffect, useRef, useState } from "react";
import { saveFieldsByKeyAction, uploadMediaAction } from "@/lib/actions";

// On-page editing overlay, rendered only for a logged-in admin visiting a
// page with ?edit=1. Text fields become contentEditable in place; clicking an
// image opens a file picker. Changes are held locally until "Save all".

type Pending = Map<string, string>;

const OUTLINE = "2px solid #6366f1";
const OUTLINE_PENDING = "2px solid #f59e0b";

export function EditOverlay({ route }: { route: string }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<Pending>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeImageRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const doc = document;
    const editables = Array.from(doc.querySelectorAll<HTMLElement>("[data-cms-field]"));

    const markPending = (el: HTMLElement, key: string, value: string) => {
      pendingRef.current.set(key, value);
      el.style.outline = OUTLINE_PENDING;
      el.style.outlineOffset = "2px";
      setPendingCount(pendingRef.current.size);
    };

    const onMouseOver = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      if (!pendingRef.current.has(el.dataset.cmsField ?? "")) {
        el.style.outline = OUTLINE;
        el.style.outlineOffset = "2px";
      }
      el.style.cursor = el.dataset.cmsType === "image" ? "pointer" : "text";
    };
    const onMouseOut = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      if (!pendingRef.current.has(el.dataset.cmsField ?? "")) {
        el.style.outline = "";
      }
    };

    const onClick = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      e.preventDefault();
      e.stopPropagation();
      const key = el.dataset.cmsField;
      if (!key) return;

      if (el.dataset.cmsType === "image") {
        activeImageRef.current = el;
        fileInputRef.current?.click();
        return;
      }

      if (el.isContentEditable) return;
      el.setAttribute("contenteditable", "plaintext-only");
      // Fallback for browsers without plaintext-only support
      if (!el.isContentEditable) el.setAttribute("contenteditable", "true");
      el.focus();

      const onInput = () => markPending(el, key, el.innerText);
      const onBlur = () => {
        el.removeAttribute("contenteditable");
        el.removeEventListener("input", onInput);
        el.removeEventListener("blur", onBlur);
      };
      el.addEventListener("input", onInput);
      el.addEventListener("blur", onBlur);
    };

    // While editing, keep links/buttons from navigating away.
    const suppressNav = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-cms-overlay]")) return;
      const link = target.closest("a");
      if (link) e.preventDefault();
    };

    for (const el of editables) {
      el.addEventListener("mouseover", onMouseOver);
      el.addEventListener("mouseout", onMouseOut);
      el.addEventListener("click", onClick);
    }
    doc.addEventListener("click", suppressNav, true);

    return () => {
      for (const el of editables) {
        el.removeEventListener("mouseover", onMouseOver);
        el.removeEventListener("mouseout", onMouseOut);
        el.removeEventListener("click", onClick);
        el.style.outline = "";
        el.removeAttribute("contenteditable");
      }
      doc.removeEventListener("click", suppressNav, true);
    };
  }, []);

  const onFileChosen = async (file: File | null) => {
    const el = activeImageRef.current;
    if (!file || !el) return;
    setError(null);
    const key = el.dataset.cmsField;
    if (!key) return;

    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadMediaAction(formData);
    if (!result.ok || !result.asset) {
      setError(result.error ?? "Upload failed.");
      return;
    }
    if (el instanceof HTMLImageElement) el.src = result.asset.url;
    pendingRef.current.set(key, result.asset.url);
    el.style.outline = OUTLINE_PENDING;
    setPendingCount(pendingRef.current.size);
  };

  const saveAll = async () => {
    if (pendingRef.current.size === 0) return;
    setSaving(true);
    setError(null);
    const updates = Array.from(pendingRef.current, ([key, value]) => ({ key, value }));
    const result = await saveFieldsByKeyAction(route, updates);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Save failed.");
      return;
    }
    // Full reload on purpose: the page must re-render on the server with the
    // saved values (revalidated), not from client cache.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `${route}?edit=1`;
  };

  const discard = () => window.location.reload();

  return (
    <div
      data-cms-overlay
      className="fixed bottom-6 right-6 z-[9999] flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-slate-100 shadow-2xl ring-1 ring-slate-700"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          void onFileChosen(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <span className="font-semibold">Edit mode</span>
      <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs">
        {pendingCount} unsaved {pendingCount === 1 ? "change" : "changes"}
      </span>
      {error ? <span className="max-w-56 text-xs text-red-400">{error}</span> : null}
      <button
        onClick={() => void saveAll()}
        disabled={saving || pendingCount === 0}
        className="rounded-lg bg-indigo-500 px-3 py-1.5 font-semibold hover:bg-indigo-400 disabled:opacity-40"
      >
        {saving ? "Saving..." : "Save all"}
      </button>
      <button
        onClick={discard}
        disabled={saving || pendingCount === 0}
        className="rounded-lg bg-slate-700 px-3 py-1.5 hover:bg-slate-600 disabled:opacity-40"
      >
        Discard
      </button>
      <a href={route} className="text-slate-400 hover:text-slate-200">Exit</a>
    </div>
  );
}
