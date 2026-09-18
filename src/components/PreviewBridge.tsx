"use client";

import { useEffect } from "react";
import { isPreviewMessage, type PreviewMessage } from "@/lib/editor-types";
import { safeUrl } from "@/lib/safe-url";

// Runs inside the editor's preview iframe (a page opened with ?preview=1 by a
// logged-in admin). It applies field edits the editor sends over postMessage
// straight to the rendered DOM, so typing in the editor updates the page
// live, and it reports clicks back so the editor can jump to that field.
// Everything crosses the boundary as field keys and plain string values.

const HOVER = "2px dashed rgba(99, 102, 241, 0.9)";
const SELECTED = "2px solid #6366f1";

function escapeKey(key: string) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key.replace(/["\\]/g, "\\$&");
}

function fieldElements(key: string): HTMLElement[] {
  const k = escapeKey(key);
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-cms-field="${k}"], [data-cms-href="${k}"], [data-cms-bg="${k}"], [data-cms-poster="${k}"]`,
    ),
  );
}

function applyField(msg: Extract<PreviewMessage, { cms: "set" }>) {
  const k = escapeKey(msg.key);
  const value = msg.value;

  for (const el of document.querySelectorAll<HTMLElement>(`[data-cms-field="${k}"]`)) {
    const kind = el.dataset.cmsType;
    if (kind === "text") {
      if (el.textContent !== value) el.textContent = value;
    } else if (kind === "image") {
      const url = safeUrl(value, "src");
      if (el instanceof HTMLImageElement || el instanceof HTMLSourceElement) {
        if (el.getAttribute("src") !== url) el.setAttribute("src", url);
        if (el instanceof HTMLImageElement) {
          el.removeAttribute("srcset");
          const picture = el.closest("picture");
          // A <picture> keeps choosing its <source> over the new src.
          picture?.querySelectorAll("source").forEach((s) => s.removeAttribute("srcset"));
        }
      } else {
        el.setAttribute("src", url);
      }
    } else if (kind === "video") {
      const url = safeUrl(value, "src");
      if (el instanceof HTMLMediaElement) {
        if (el.getAttribute("src") !== url) {
          el.setAttribute("src", url);
          el.load();
        }
      } else {
        el.setAttribute("src", url);
      }
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>(`[data-cms-href="${k}"]`)) {
    el.setAttribute("href", safeUrl(value, "href"));
  }
  for (const el of document.querySelectorAll<HTMLElement>(`[data-cms-bg="${k}"]`)) {
    el.style.backgroundImage = `url("${safeUrl(value, "src").replace(/"/g, "%22")}")`;
  }
  for (const el of document.querySelectorAll<HTMLElement>(`[data-cms-poster="${k}"]`)) {
    el.setAttribute("poster", safeUrl(value, "src"));
  }
}

export function PreviewBridge() {
  useEffect(() => {
    const parentWindow = window.parent;
    if (!parentWindow || parentWindow === window) return;
    const origin = window.location.origin;
    const post = (m: PreviewMessage) => parentWindow.postMessage(m, origin);

    let selected: HTMLElement[] = [];
    const paint = (els: HTMLElement[], outline: string) => {
      for (const el of els) {
        el.style.outline = outline;
        el.style.outlineOffset = "2px";
      }
    };
    const clear = (els: HTMLElement[]) => {
      for (const el of els) {
        if (!selected.includes(el)) el.style.outline = "";
      }
    };

    // The editor may not be listening yet when this frame hydrates (or the
    // other way round), so "ready" is repeated until acknowledged and also
    // answered whenever the editor says hello.
    let acked = false;
    const announce = () => post({ cms: "ready" });
    const retry = setInterval(() => {
      if (acked) clearInterval(retry);
      else announce();
    }, 400);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || !isPreviewMessage(event.data)) return;
      const msg = event.data;
      if (msg.cms === "ack") acked = true;
      if (msg.cms === "hello") announce();
      if (msg.cms === "set") applyField(msg);
      if (msg.cms === "highlight") {
        clear(selected);
        for (const el of selected) el.style.outline = "";
        selected = msg.key ? fieldElements(msg.key) : [];
        paint(selected, SELECTED);
        selected[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };

    const EDITABLE = "[data-cms-field], [data-cms-href], [data-cms-bg], [data-cms-poster]";
    // Images usually sit under gradient tints and empty positioned layers, so
    // look through everything stacked under the pointer for the editable one.
    const editableFrom = (e: MouseEvent): HTMLElement | null => {
      const direct = e.target instanceof Element ? e.target.closest<HTMLElement>(EDITABLE) : null;
      if (direct) return direct;
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        const hit = el instanceof HTMLElement ? el.closest<HTMLElement>(EDITABLE) : null;
        if (hit) return hit;
      }
      return null;
    };

    const keyOf = (el: HTMLElement) =>
      el.dataset.cmsField ?? el.dataset.cmsHref ?? el.dataset.cmsBg ?? el.dataset.cmsPoster ?? null;

    let hovered: HTMLElement | null = null;
    const onOver = (e: MouseEvent) => {
      const el = editableFrom(e);
      if (el === hovered) return;
      if (hovered) clear([hovered]);
      hovered = el;
      if (hovered && !selected.includes(hovered)) paint([hovered], HOVER);
    };
    const onClick = (e: MouseEvent) => {
      // Nothing navigates or submits inside the preview; a click means "edit this".
      e.preventDefault();
      e.stopPropagation();
      const el = editableFrom(e);
      const key = el ? keyOf(el) : null;
      if (key) post({ cms: "select", key });
    };
    const onSubmit = (e: Event) => e.preventDefault();

    window.addEventListener("message", onMessage);
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    document.documentElement.dataset.cmsPreview = "1";
    announce();

    return () => {
      clearInterval(retry);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      delete document.documentElement.dataset.cmsPreview;
    };
  }, []);

  return (
    <style>{`
      [data-cms-field], [data-cms-href], [data-cms-bg] { cursor: pointer; }
      html[data-cms-preview] { scroll-behavior: smooth; }
    `}</style>
  );
}
