"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { saveFieldsByKeyAction, uploadMediaAction } from "@/lib/actions";
import { safeUrl } from "@/lib/safe-url";

// On-page editing, rendered only for a logged-in admin visiting a page with
// ?edit=1. Text edits in place (contentEditable), images and backgrounds
// through a file picker, links and videos through the URL box in the toolbar.
// Changes are held locally until "Save all"; the save revalidates the route
// and refreshes the server-rendered page in place — no full reload.

const OUTLINE = "2px solid #6366f1";
const OUTLINE_PENDING = "2px solid #f59e0b";

type UrlTarget = { key: string; kind: "link" | "video"; value: string };
type FileTarget = { key: string; kind: "image" | "video" | "bg"; el: HTMLElement };

const EDITABLE = "[data-cms-field], [data-cms-href], [data-cms-bg]";

export function EditOverlay({ route, pageId }: { route: string; pageId: string }) {
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState(0);
  const [urlTarget, setUrlTarget] = useState<UrlTarget | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [bgBadge, setBgBadge] = useState<{ key: string; top: number; left: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pendingRef = useRef<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileTargetRef = useRef<FileTarget | null>(null);
  const bgElRef = useRef<HTMLElement | null>(null);

  const markPending = (key: string, value: string) => {
    pendingRef.current.set(key, value);
    for (const el of elementsFor(key)) {
      el.style.outline = OUTLINE_PENDING;
      el.style.outlineOffset = "2px";
    }
    setPendingCount(pendingRef.current.size);
  };

  /** Apply a value to the DOM the way the renderer would, so the page previews the edit. */
  const applyValue = (key: string, value: string) => {
    for (const el of elementsFor(key)) {
      if (el.dataset.cmsHref === key) el.setAttribute("href", safeUrl(value, "href"));
      if (el.dataset.cmsBg === key) el.style.backgroundImage = `url("${safeUrl(value, "src").replace(/"/g, "%22")}")`;
      if (el.dataset.cmsField === key) {
        if (el.dataset.cmsType === "image") {
          el.setAttribute("src", safeUrl(value, "src"));
          el.removeAttribute("srcset");
        } else if (el.dataset.cmsType === "video") {
          el.setAttribute("src", safeUrl(value, "src"));
          if (el instanceof HTMLMediaElement) el.load();
        }
      }
    }
    markPending(key, value);
  };

  useEffect(() => {
    const doc = document;
    let hovered: HTMLElement | null = null;
    const isPending = (el: HTMLElement) =>
      [el.dataset.cmsField, el.dataset.cmsHref, el.dataset.cmsBg].some((k) => k && pendingRef.current.has(k));

    // Hero images usually sit under gradient tints and empty positioned
    // layers, so the element under the cursor is rarely the editable one.
    // Walk everything stacked at that point and take the first that carries
    // content — the way a designer expects "click the picture" to work.
    const editableAt = (e: MouseEvent): HTMLElement | null => {
      const direct = (e.target as HTMLElement).closest<HTMLElement>(EDITABLE);
      if (direct) return direct;
      for (const el of doc.elementsFromPoint(e.clientX, e.clientY)) {
        if (!(el instanceof HTMLElement) || el.closest("[data-cms-overlay]")) continue;
        const hit = el.closest<HTMLElement>(EDITABLE);
        if (hit) return hit;
      }
      return null;
    };

    const paintHover = (el: HTMLElement | null) => {
      if (hovered && hovered !== el && !isPending(hovered)) hovered.style.outline = "";
      hovered = el;
      if (el && !isPending(el)) {
        el.style.outline = OUTLINE;
        el.style.outlineOffset = "2px";
      }
    };

    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-cms-overlay]")) return;
      const el = editableAt(e);
      paintHover(el);
      const bg = (el ?? target).closest<HTMLElement>("[data-cms-bg]");
      if (bg && bg !== bgElRef.current) {
        bgElRef.current = bg;
        const rect = bg.getBoundingClientRect();
        setBgBadge({ key: bg.dataset.cmsBg!, top: Math.max(8, rect.top + 8), left: Math.max(8, rect.right - 8) });
      } else if (!bg && bgElRef.current) {
        bgElRef.current = null;
        setBgBadge(null);
      }
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-cms-overlay]")) return;
      // Nothing navigates or submits while editing.
      e.preventDefault();
      const el = editableAt(e);
      if (!el) return;
      e.stopPropagation();

      // The link is often the *parent* of the text span that was clicked.
      const hrefKey = (el.closest<HTMLElement>("[data-cms-href]") ?? target.closest<HTMLElement>("[data-cms-href]"))?.dataset.cmsHref;
      if (hrefKey) {
        const current = pendingRef.current.get(hrefKey) ?? el.getAttribute("href") ?? "";
        setUrlTarget({ key: hrefKey, kind: "link", value: current });
        setUrlDraft(current);
      }

      const key = el.dataset.cmsField;
      if (!key) return;
      const kind = el.dataset.cmsType;
      if (kind === "image") {
        fileTargetRef.current = { key, kind: "image", el };
        fileInputRef.current?.click();
        return;
      }
      if (kind === "video") {
        const current = pendingRef.current.get(key) ?? el.getAttribute("src") ?? "";
        setUrlTarget({ key, kind: "video", value: current });
        setUrlDraft(current);
        return;
      }
      if (el.isContentEditable) return;
      el.setAttribute("contenteditable", "plaintext-only");
      if (!el.isContentEditable) el.setAttribute("contenteditable", "true"); // no plaintext-only support
      el.focus();
      const onInput = () => markPending(key, el.innerText);
      const onBlur = () => {
        el.removeAttribute("contenteditable");
        el.removeEventListener("input", onInput);
        el.removeEventListener("blur", onBlur);
      };
      el.addEventListener("input", onInput);
      el.addEventListener("blur", onBlur);
    };

    const onSubmit = (e: Event) => e.preventDefault();

    doc.addEventListener("mouseover", onOver, true);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("submit", onSubmit, true);
    const style = doc.createElement("style");
    style.textContent = `[data-cms-field][data-cms-type="text"]{cursor:text}[data-cms-type="image"],[data-cms-type="video"],[data-cms-href]{cursor:pointer}`;
    doc.head.appendChild(style);

    return () => {
      doc.removeEventListener("mouseover", onOver, true);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("submit", onSubmit, true);
      style.remove();
      for (const el of doc.querySelectorAll<HTMLElement>(EDITABLE)) {
        el.style.outline = "";
        el.removeAttribute("contenteditable");
      }
    };
  }, []);

  // Leaving with pending edits silently discards them.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pendingRef.current.size > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const upload = useMutation({
    mutationFn: async ({ file, target }: { file: File; target: FileTarget }) => {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadMediaAction(fd);
      if (!result.ok || !result.asset) throw new Error(result.error ?? "Upload failed.");
      return { url: result.asset.url, target };
    },
    onSuccess: ({ url, target }) => {
      setNotice(null);
      applyValue(target.key, url);
    },
    onError: (e) => setNotice(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const updates = Array.from(pendingRef.current, ([key, value]) => ({ key, value }));
      const result = await saveFieldsByKeyAction(route, updates);
      if (!result.ok) throw new Error(result.error ?? "Save failed.");
      return updates.length;
    },
    onSuccess: (count) => {
      for (const el of document.querySelectorAll<HTMLElement>(EDITABLE)) {
        el.style.outline = "";
        el.removeAttribute("contenteditable");
      }
      pendingRef.current.clear();
      setPendingCount(0);
      setUrlTarget(null);
      setNotice(`Saved ${count} change${count === 1 ? "" : "s"} — live.`);
      // Re-render the server component with the saved values, in place.
      router.refresh();
    },
    onError: (e) => setNotice(e.message),
  });

  const discard = () => window.location.reload();

  const applyUrl = () => {
    if (!urlTarget) return;
    applyValue(urlTarget.key, urlDraft.trim());
    setUrlTarget(null);
  };

  const canSave = pendingCount > 0 && !save.isPending;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = fileTargetRef.current;
          if (file && target) upload.mutate({ file, target });
          e.target.value = "";
        }}
      />

      {bgBadge ? (
        <button
          data-cms-overlay
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const el = bgElRef.current;
            if (!el) return;
            fileTargetRef.current = { key: bgBadge.key, kind: "bg", el };
            fileInputRef.current?.click();
          }}
          style={{ top: bgBadge.top, left: bgBadge.left, transform: "translateX(-100%)" }}
          className="fixed z-[9998] rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white shadow-lg hover:bg-indigo-500"
        >
          Change background
        </button>
      ) : null}

      <div
        data-cms-overlay
        // Bottom-left: imported pages tend to park their own floating nav at
        // the bottom centre or right, and the toolbar must not cover it.
        className="fixed bottom-4 left-4 z-[9999] flex max-w-[min(92vw,720px)] flex-col gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-slate-100 shadow-2xl ring-1 ring-slate-700"
      >
        {urlTarget ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs font-semibold text-slate-300">
              {urlTarget.kind === "link" ? "Link URL" : "Video URL"}
            </span>
            <input
              autoFocus
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyUrl();
                if (e.key === "Escape") setUrlTarget(null);
              }}
              spellCheck={false}
              className="w-72 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 font-mono text-xs text-slate-100 outline-none focus:border-indigo-400"
            />
            <button onClick={applyUrl} className="rounded-md bg-indigo-500 px-2.5 py-1 text-xs font-semibold hover:bg-indigo-400">
              Apply
            </button>
            {urlTarget.kind === "video" ? (
              <label className="cursor-pointer rounded-md bg-slate-700 px-2.5 py-1 text-xs hover:bg-slate-600">
                Upload
                <input
                  type="file"
                  className="hidden"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    const el = document.querySelector<HTMLElement>(`[data-cms-field="${CSS.escape(urlTarget.key)}"]`);
                    if (file && el) upload.mutate({ file, target: { key: urlTarget.key, kind: "video", el } });
                    e.target.value = "";
                    setUrlTarget(null);
                  }}
                />
              </label>
            ) : null}
            <button onClick={() => setUrlTarget(null)} className="text-xs text-slate-400 hover:text-slate-200">Cancel</button>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <span className="font-semibold">Edit mode</span>
          <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs">
            {pendingCount} unsaved {pendingCount === 1 ? "change" : "changes"}
          </span>
          {upload.isPending ? <span className="text-xs text-slate-400">Uploading...</span> : null}
          {notice ? (
            <span className={`max-w-64 truncate text-xs ${/failed|error|too|not/i.test(notice) ? "text-red-400" : "text-emerald-400"}`}>
              {notice}
            </span>
          ) : null}
          <button
            onClick={() => save.mutate()}
            disabled={!canSave}
            className="rounded-lg bg-indigo-500 px-3 py-1.5 font-semibold hover:bg-indigo-400 disabled:opacity-40"
          >
            {save.isPending ? "Saving..." : "Save all"}
          </button>
          <button
            onClick={discard}
            disabled={pendingCount === 0 || save.isPending}
            className="rounded-lg bg-slate-700 px-3 py-1.5 hover:bg-slate-600 disabled:opacity-40"
          >
            Discard
          </button>
          <Link href={`/admin/pages/${pageId}`} className="text-slate-400 hover:text-slate-200">Editor</Link>
          <a href={route} className="text-slate-400 hover:text-slate-200">Exit</a>
        </div>
      </div>
    </>
  );
}

function elementsFor(key: string): HTMLElement[] {
  const k = CSS.escape(key);
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[data-cms-field="${k}"], [data-cms-href="${k}"], [data-cms-bg="${k}"]`),
  );
}
