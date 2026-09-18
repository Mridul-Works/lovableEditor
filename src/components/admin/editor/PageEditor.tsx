"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveFieldsAction, setPageStatusAction, syncPageAction } from "@/lib/actions";
import {
  isPreviewMessage,
  queryKeys,
  type FieldData,
  type PageFieldsResponse,
  type PreviewMessage,
} from "@/lib/editor-types";
import { FieldRow } from "./FieldRows";
import { MediaPicker } from "./MediaPicker";
import { PreviewPane } from "./PreviewPane";

// The page editor. Server state (fields as saved) lives in TanStack Query;
// unsaved edits live in a local draft map keyed by field id. Every keystroke
// is mirrored into the live preview iframe over postMessage, and clicking an
// element in the preview scrolls the (virtualized) field list to its row.

const COLLAPSE_ABOVE = 150;

type Row =
  | { kind: "section"; id: string; section: string; title: string; count: number; open: boolean }
  | { kind: "field"; id: string; field: FieldData }
  | { kind: "orphans"; id: string; count: number }
  | { kind: "orphan"; id: string; field: FieldData };

function sectionTitle(slug: string, fields: FieldData[]) {
  if (slug === "meta") return "SEO / Meta";
  if (slug === "page") return "Page";
  const name = slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  if (!/^section \d+$/i.test(name)) return name;
  // A numbered section says nothing about its content; borrow its heading.
  const heading =
    fields.find((f) => f.type === "TEXT" && /-h[1-3]-/.test(f.key)) ??
    fields.find((f) => f.type === "TEXT" && (f.value ?? f.defaultValue).trim().length > 3);
  const hint = heading ? (heading.value ?? heading.defaultValue).trim() : "";
  return hint ? `${name} · ${hint.length > 48 ? hint.slice(0, 45) + "..." : hint}` : name;
}

async function fetchFields(pageId: string): Promise<PageFieldsResponse> {
  const res = await fetch(`/api/admin/pages/${pageId}/fields`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Could not load fields (${res.status})`);
  return res.json() as Promise<PageFieldsResponse>;
}

export function PageEditor({ initial }: { initial: PageFieldsResponse }) {
  const pageId = initial.page.id;
  const qc = useQueryClient();
  const router = useRouter();

  const { data } = useQuery({
    queryKey: queryKeys.pageFields(pageId),
    queryFn: () => fetchFields(pageId),
    initialData: initial,
    initialDataUpdatedAt: Date.now(),
  });
  const { page, fields } = data;
  const fieldsByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  // ---- drafts ------------------------------------------------------------
  // id → draft value; null means "back to the imported default".
  const [drafts, setDrafts] = useState<Record<string, string | null>>({});
  const dirtyIds = useMemo(
    () => fields.filter((f) => f.id in drafts && (drafts[f.id] ?? null) !== (f.value ?? null)).map((f) => f.id),
    [drafts, fields],
  );
  const dirty = dirtyIds.length > 0;
  const currentValue = useCallback(
    (f: FieldData) => (f.id in drafts ? (drafts[f.id] ?? f.defaultValue) : (f.value ?? f.defaultValue)),
    [drafts],
  );

  // ---- preview messaging -------------------------------------------------
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const post = useCallback((msg: PreviewMessage) => {
    iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);

  const setDraft = (f: FieldData, value: string | null) => {
    setDrafts((prev) => ({ ...prev, [f.id]: value }));
    post({ cms: "set", key: f.key, type: f.type, value: value ?? f.defaultValue });
  };

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isPreviewMessage(event.data)) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data;
      if (msg.cms === "ready") {
        post({ cms: "ack" });
        setPreviewReady(true);
        // A freshly loaded frame shows saved values; replay the unsaved edits.
        for (const f of fields) {
          if (f.id in drafts) post({ cms: "set", key: f.key, type: f.type, value: currentValue(f) });
        }
      } else if (msg.cms === "select") {
        setPendingFocusKey(msg.key);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fields, drafts, currentValue, post]);

  // ---- mutations ---------------------------------------------------------
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const save = useMutation({
    mutationFn: async (updates: Array<{ id: string; value: string | null }>) => {
      const result = await saveFieldsAction(pageId, updates);
      if (!result.ok) throw new Error(result.error ?? "Save failed.");
      return updates;
    },
    onSuccess: (updates) => {
      qc.setQueryData<PageFieldsResponse>(queryKeys.pageFields(pageId), (old) =>
        old
          ? {
              ...old,
              fields: old.fields.map((f) => {
                const u = updates.find((x) => x.id === f.id);
                return u ? { ...f, value: u.value } : f;
              }),
            }
          : old,
      );
      setDrafts((prev) => {
        const next = { ...prev };
        for (const u of updates) delete next[u.id];
        return next;
      });
      setNotice({ tone: "ok", text: `Saved ${updates.length} change${updates.length === 1 ? "" : "s"} — live now.` });
      void qc.invalidateQueries({ queryKey: queryKeys.pageFields(pageId) });
    },
    onError: (e) => setNotice({ tone: "error", text: e.message }),
  });

  const saveAll = useCallback(() => {
    if (!dirty || save.isPending) return;
    save.mutate(dirtyIds.map((id) => ({ id, value: drafts[id] ?? null })));
  }, [dirty, dirtyIds, drafts, save]);

  const discard = () => {
    for (const f of fields) {
      if (f.id in drafts) post({ cms: "set", key: f.key, type: f.type, value: f.value ?? f.defaultValue });
    }
    setDrafts({});
    setNotice(null);
  };

  const status = useMutation({
    mutationFn: async (next: "DRAFT" | "PUBLISHED") => {
      await setPageStatusAction(pageId, next);
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData<PageFieldsResponse>(queryKeys.pageFields(pageId), (old) =>
        old ? { ...old, page: { ...old.page, status: next } } : old,
      );
      router.refresh();
    },
  });

  const sync = useMutation({
    mutationFn: async () => {
      const result = await syncPageAction(pageId);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (result) => {
      const m = result.report?.merge;
      setNotice({
        tone: "ok",
        text: m ? `Synced from GitHub — kept ${m.kept}, added ${m.added}, orphaned ${m.orphaned}.` : "Synced from GitHub.",
      });
      void qc.invalidateQueries({ queryKey: queryKeys.pageFields(pageId) });
      reloadPreview();
    },
    onError: (e) => setNotice({ tone: "error", text: e.message }),
  });

  // Ctrl/Cmd+S saves; leaving with unsaved edits asks first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveAll]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ---- rows (search, sections, orphans) ----------------------------------
  const [query, setQuery] = useState("");
  const startsCollapsed = fields.length > COLLAPSE_ABOVE;
  const [toggled, setToggled] = useState<Set<string>>(new Set()); // sections flipped from their default
  const [showOrphans, setShowOrphans] = useState(false);
  const isOpen = useCallback(
    (section: string) => (startsCollapsed ? toggled.has(section) : !toggled.has(section)),
    [startsCollapsed, toggled],
  );
  const openSection = (section: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (startsCollapsed) next.add(section);
      else next.delete(section);
      return next;
    });
  const toggleSection = (section: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  const searching = query.trim().length > 0;
  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (f: FieldData) =>
      !needle ||
      f.label.toLowerCase().includes(needle) ||
      f.defaultValue.toLowerCase().includes(needle) ||
      (f.value ?? "").toLowerCase().includes(needle) ||
      f.key.toLowerCase().includes(needle) ||
      f.section.toLowerCase().includes(needle);

    const bySection = new Map<string, FieldData[]>();
    const orphans: FieldData[] = [];
    for (const f of fields) {
      if (!matches(f)) continue;
      if (f.orphaned) {
        orphans.push(f);
        continue;
      }
      const list = bySection.get(f.section) ?? [];
      list.push(f);
      bySection.set(f.section, list);
    }
    const out: Row[] = [];
    for (const [section, list] of bySection) {
      const open = searching || isOpen(section);
      out.push({ kind: "section", id: `s:${section}`, section, title: sectionTitle(section, list), count: list.length, open });
      if (open) for (const f of list) out.push({ kind: "field", id: f.id, field: f });
    }
    if (orphans.length > 0) {
      out.push({ kind: "orphans", id: "orphans", count: orphans.length });
      if (showOrphans) for (const f of orphans) out.push({ kind: "orphan", id: f.id, field: f });
    }
    return out;
  }, [fields, query, searching, isOpen, showOrphans]);

  const shown = rows.filter((r) => r.kind === "field").length;

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    getItemKey: (i) => rows[i].id,
    estimateSize: (i) => {
      const row = rows[i];
      if (row.kind === "section" || row.kind === "orphans") return 52;
      if (row.kind === "orphan") return 40;
      const f = row.field;
      if (f.type === "IMAGE" || f.type === "VIDEO") return 140;
      return f.defaultValue.length > 70 ? 118 : 88;
    },
    overscan: 8,
  });

  // A click in the preview: open the field's section, scroll its row into
  // view and focus the input once the row exists.
  useEffect(() => {
    if (!pendingFocusKey) return;
    const field = fieldsByKey.get(pendingFocusKey);
    if (!field) {
      setPendingFocusKey(null);
      return;
    }
    if (query) setQuery("");
    if (!field.orphaned && !isOpen(field.section) && !searching) {
      openSection(field.section);
      return; // rows will change; this effect re-runs
    }
    if (field.orphaned && !showOrphans) {
      setShowOrphans(true);
      return;
    }
    const index = rows.findIndex((r) => (r.kind === "field" || r.kind === "orphan") && r.id === field.id);
    if (index < 0) return;
    virtualizer.scrollToIndex(index, { align: "center" });
    setFocusedId(field.id);
    setPendingFocusKey(null);
    post({ cms: "highlight", key: field.key });
    const focusInput = () => {
      const input = document.getElementById(`field-${field.id}`)?.querySelector<HTMLElement>("[data-field-input]");
      if (input) {
        input.focus({ preventScroll: true });
        return true;
      }
      return false;
    };
    let tries = 0;
    const tick = () => {
      if (focusInput() || tries++ > 20) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocusKey, rows, fieldsByKey, isOpen, searching, showOrphans, query]);

  const reloadPreview = () => {
    setPreviewReady(false);
    const frame = iframeRef.current;
    if (frame) frame.src = frame.src;
  };

  const [picker, setPicker] = useState<{ field: FieldData } | null>(null);

  // ---- render ------------------------------------------------------------
  return (
    <div className="-m-8 flex h-screen flex-col bg-neutral-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-5 py-3">
        <Link href="/admin" className="text-sm text-neutral-500 hover:text-neutral-900">← Pages</Link>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold leading-tight">{page.title}</h1>
          <p className="font-mono text-xs text-neutral-500">{page.route}</p>
        </div>
        <span
          className={
            page.status === "PUBLISHED"
              ? "rounded-full bg-mint px-2.5 py-0.5 text-xs font-semibold text-leaf"
              : "rounded-full bg-ember/15 px-2.5 py-0.5 text-xs font-semibold text-ember-ink"
          }
        >
          {page.status === "PUBLISHED" ? "Published" : "Draft"}
        </span>
        <div className="ml-auto flex items-center gap-2 text-xs font-medium">
          {page.sourceRepo ? (
            <button
              type="button"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              title={`Re-import ${page.sourceRepo}; your edits are kept`}
              className="rounded-full border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              {sync.isPending ? "Syncing..." : "Sync from GitHub"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => status.mutate(page.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED")}
            disabled={status.isPending}
            className="rounded-full border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {page.status === "PUBLISHED" ? "Unpublish" : "Publish"}
          </button>
          <a
            href={page.route}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:bg-neutral-50"
          >
            View live ↗
          </a>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Field list */}
        <section className="flex w-[520px] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
          <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${fields.length} fields...`}
              className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-sun/60"
            />
            <span className="shrink-0 text-xs text-neutral-500">{shown} shown</span>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
                  >
                    {row.kind === "section" ? (
                      <button
                        type="button"
                        onClick={() => toggleSection(row.section)}
                        className="flex w-full items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-neutral-600 hover:bg-neutral-50"
                      >
                        <span className="truncate pr-3 normal-case tracking-normal">
                          <span className="uppercase tracking-wide">{row.title.split(" · ")[0]}</span>
                          {row.title.includes(" · ") ? (
                            <span className="ml-2 font-medium text-neutral-400">{row.title.split(" · ").slice(1).join(" · ")}</span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-2 font-medium normal-case tracking-normal text-neutral-400">
                          {row.count} field{row.count === 1 ? "" : "s"}
                          <span aria-hidden>{row.open ? "−" : "+"}</span>
                        </span>
                      </button>
                    ) : row.kind === "orphans" ? (
                      <button
                        type="button"
                        onClick={() => setShowOrphans((v) => !v)}
                        className="flex w-full items-center justify-between border-y border-ember/30 bg-ember/10 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-ember-ink"
                      >
                        <span>Orphaned — edited text no longer in the page</span>
                        <span className="font-medium normal-case tracking-normal">{row.count} {showOrphans ? "−" : "+"}</span>
                      </button>
                    ) : row.kind === "orphan" ? (
                      <div className="flex items-baseline gap-3 bg-ember/5 px-4 py-2 text-xs text-ember-ink">
                        <code className="shrink-0 rounded bg-ember/15 px-1.5 py-0.5">{row.field.key}</code>
                        <span className="truncate">{row.field.value ?? row.field.defaultValue}</span>
                      </div>
                    ) : (
                      <div
                        id={`field-${row.field.id}`}
                        className={`border-b border-neutral-200 px-4 py-3 ${focusedId === row.field.id ? "bg-sun/15" : "bg-white"}`}
                      >
                        <FieldRow
                          field={row.field}
                          value={currentValue(row.field)}
                          edited={(row.field.id in drafts ? drafts[row.field.id] : row.field.value) !== null}
                          dirty={dirtyIds.includes(row.field.id)}
                          focused={focusedId === row.field.id}
                          onChange={(v) => setDraft(row.field, v)}
                          onReset={() => setDraft(row.field, null)}
                          onFocus={() => {
                            setFocusedId(row.field.id);
                            post({ cms: "highlight", key: row.field.key });
                          }}
                          onBlur={() => post({ cms: "highlight", key: null })}
                          onPick={() => setPicker({ field: row.field })}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {rows.length === 0 ? (
              <p className="p-8 text-center text-sm text-neutral-500">No fields match “{query}”.</p>
            ) : null}
          </div>

          {/* Save bar */}
          <div className="flex items-center gap-3 border-t border-neutral-200 bg-white px-4 py-3">
            <button
              type="button"
              onClick={saveAll}
              disabled={!dirty || save.isPending}
              className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-coal disabled:opacity-40"
            >
              {save.isPending ? "Saving..." : dirty ? `Save ${dirtyIds.length} change${dirtyIds.length === 1 ? "" : "s"}` : "Saved"}
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={!dirty || save.isPending}
              className="rounded-full border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
            >
              Discard
            </button>
            <span className="min-w-0 flex-1 truncate text-xs">
              {dirty ? (
                <span className="font-medium text-ember-ink">Unsaved changes · Ctrl+S to save</span>
              ) : notice ? (
                <span className={notice.tone === "ok" ? "text-leaf" : "text-alert"}>{notice.text}</span>
              ) : (
                <span className="text-neutral-400">Edits go live on save.</span>
              )}
            </span>
          </div>
        </section>

        {/* Preview */}
        <div className="min-w-0 flex-1">
          <PreviewPane
            ref={iframeRef}
            route={page.route}
            onReload={reloadPreview}
            onLoad={() => post({ cms: "hello" })}
            ready={previewReady}
          />
        </div>
      </div>

      {picker ? (
        <MediaPicker
          kind={picker.field.type === "VIDEO" ? "video" : "image"}
          onClose={() => setPicker(null)}
          onSelect={(url) => {
            setDraft(picker.field, url);
            setPicker(null);
          }}
        />
      ) : null}
    </div>
  );
}
