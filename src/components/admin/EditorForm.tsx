"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveFieldsAction, uploadMediaAction } from "@/lib/actions";

type FieldData = {
  id: string;
  key: string;
  type: "TEXT" | "IMAGE";
  label: string;
  section: string;
  defaultValue: string;
  value: string | null;
  orphaned: boolean;
  sortOrder: number;
};

type AssetData = { id: string; url: string; filename: string; width: number | null; height: number | null };

function sectionTitle(slug: string) {
  if (slug === "meta") return "SEO / Meta";
  return slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function EditorForm({
  pageId,
  route,
  fields,
  assets,
}: {
  pageId: string;
  route: string;
  fields: FieldData[];
  assets: AssetData[];
}) {
  // Current values keyed by field id; null means "use default".
  const [values, setValues] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, f.value])),
  );
  const [savedValues, setSavedValues] = useState(values);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // A re-synced page can carry well over a thousand fields. Rendering them all
  // at once makes the editor unusable, so large pages start collapsed and are
  // opened one section at a time.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const dirtyIds = useMemo(
    () => Object.keys(values).filter((id) => (values[id] ?? null) !== (savedValues[id] ?? null)),
    [values, savedValues],
  );
  const dirty = dirtyIds.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const COLLAPSE_ABOVE = 150;
  const startsCollapsed = fields.length > COLLAPSE_ABOVE;

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (f: FieldData) =>
      !needle ||
      f.label.toLowerCase().includes(needle) ||
      f.defaultValue.toLowerCase().includes(needle) ||
      (f.value ?? "").toLowerCase().includes(needle) ||
      f.key.toLowerCase().includes(needle);

    const active = fields.filter((f) => !f.orphaned && matches(f));
    const orphaned = fields.filter((f) => f.orphaned && matches(f));
    const bySection = new Map<string, FieldData[]>();
    for (const f of active) {
      const list = bySection.get(f.section) ?? [];
      list.push(f);
      bySection.set(f.section, list);
    }
    return { sections: [...bySection.entries()], orphaned, total: active.length };
  }, [fields, query]);

  // Searching should show what it found, not hide it behind a collapsed header.
  const searching = query.trim().length > 0;
  const isOpen = (section: string) =>
    searching || openSections.has(section) || (!startsCollapsed && !openSections.has(`closed:${section}`));

  const toggleSection = (section: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      const open = isOpen(section);
      if (open) {
        next.delete(section);
        if (!startsCollapsed) next.add(`closed:${section}`);
      } else {
        next.delete(`closed:${section}`);
        next.add(section);
      }
      return next;
    });

  const setValue = (id: string, v: string | null) => setValues((prev) => ({ ...prev, [id]: v }));

  const saveAll = () =>
    startSaving(async () => {
      setMessage(null);
      const updates = dirtyIds.map((id) => ({ id, value: values[id] ?? null }));
      const result = await saveFieldsAction(pageId, updates);
      if (result.ok) {
        setSavedValues({ ...values });
        setMessage("Saved — changes are live.");
      } else {
        setMessage(result.error ?? "Save failed.");
      }
    });

  const current = (f: FieldData) => values[f.id] ?? f.defaultValue;

  return (
    <div className="space-y-6 pb-24">
      <div className="sticky top-0 z-10 -mx-1 flex items-center gap-3 bg-slate-100/95 px-1 py-3 backdrop-blur">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${fields.length} fields by text or name...`}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
        />
        <span className="shrink-0 text-xs font-medium text-slate-500">
          {groups.total} shown
        </span>
      </div>

      {groups.sections.map(([section, sectionFields]) => (
        <section key={section} className="rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => toggleSection(section)}
            className="flex w-full items-center justify-between border-b border-slate-100 px-5 py-3 text-left text-sm font-bold uppercase tracking-wide text-slate-500 hover:bg-slate-50"
          >
            <span>{sectionTitle(section)}</span>
            <span className="flex items-center gap-2 text-xs font-medium normal-case tracking-normal text-slate-400">
              {sectionFields.length} field{sectionFields.length === 1 ? "" : "s"}
              <span aria-hidden>{isOpen(section) ? "\u2212" : "+"}</span>
            </span>
          </button>
          <div className={isOpen(section) ? "space-y-5 p-5" : "hidden"}>
            {sectionFields.map((f) =>
              f.type === "IMAGE" ? (
                <ImageFieldRow
                  key={f.id}
                  field={f}
                  value={current(f)}
                  edited={(values[f.id] ?? null) !== null}
                  onReplace={(url) => setValue(f.id, url)}
                  onReset={() => setValue(f.id, null)}
                  onPick={() => setPickerFor(f.id)}
                />
              ) : (
                <TextFieldRow
                  key={f.id}
                  field={f}
                  value={current(f)}
                  edited={(values[f.id] ?? null) !== null}
                  onChange={(v) => setValue(f.id, v)}
                  onReset={() => setValue(f.id, null)}
                />
              ),
            )}
          </div>
        </section>
      ))}

      {groups.orphaned.length > 0 ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50">
          <h2 className="border-b border-amber-200 px-5 py-3 text-sm font-bold uppercase tracking-wide text-amber-700">
            Orphaned fields — no longer in the imported page (kept, not rendered)
          </h2>
          <div className="space-y-3 p-5 text-sm text-amber-900">
            {groups.orphaned.map((f) => (
              <div key={f.id} className="flex items-baseline gap-3">
                <code className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs">{f.key}</code>
                <span className="truncate">{f.value ?? f.defaultValue}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-56 right-0 border-t border-slate-200 bg-white/95 px-8 py-3 backdrop-blur">
        <div className="flex max-w-4xl items-center gap-4">
          <button
            onClick={saveAll}
            disabled={!dirty || saving}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {saving ? "Saving..." : `Save all${dirty ? ` (${dirtyIds.length})` : ""}`}
          </button>
          {dirty ? (
            <span className="text-sm font-medium text-amber-600">Unsaved changes</span>
          ) : message ? (
            <span className={`text-sm font-medium ${message.startsWith("Saved") ? "text-emerald-600" : "text-red-600"}`}>
              {message}
            </span>
          ) : null}
          <span className="ml-auto text-xs text-slate-400">
            Changes go live on <span className="font-mono">{route}</span> immediately after saving.
          </span>
        </div>
      </div>

      {pickerFor ? (
        <MediaPicker
          assets={assets}
          onClose={() => setPickerFor(null)}
          onSelect={(url) => {
            setValue(pickerFor, url);
            setPickerFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function FieldHeader({ field, edited, onReset }: { field: FieldData; edited: boolean; onReset: () => void }) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <span className="text-sm font-medium text-slate-700">{field.label || field.key}</span>
      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">{field.key}</code>
      {edited ? (
        <button onClick={onReset} className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
          Reset to imported value
        </button>
      ) : null}
    </div>
  );
}

function TextFieldRow({
  field, value, edited, onChange, onReset,
}: {
  field: FieldData; value: string; edited: boolean;
  onChange: (v: string) => void; onReset: () => void;
}) {
  const long = field.defaultValue.length > 80 || field.defaultValue.includes("\n");
  return (
    <div>
      <FieldHeader field={field} edited={edited} onReset={onReset} />
      {long ? (
        <textarea
          value={value}
          rows={Math.min(6, Math.max(2, Math.ceil(value.length / 90)))}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
        />
      )}
    </div>
  );
}

function ImageFieldRow({
  field, value, edited, onReplace, onReset, onPick,
}: {
  field: FieldData; value: string; edited: boolean;
  onReplace: (url: string) => void; onReset: () => void; onPick: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadMediaAction(fd);
    setUploading(false);
    if (result.ok && result.asset) onReplace(result.asset.url);
    else setError(result.error ?? "Upload failed.");
  };

  return (
    <div>
      <FieldHeader field={field} edited={edited} onReset={onReset} />
      <div className="flex items-center gap-4">
        {/* Values can be data: URIs or external URLs; plain img keeps it simple */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={value}
          alt={field.label}
          className="h-20 w-32 rounded-lg border border-slate-200 bg-slate-50 object-cover"
        />
        <div className="flex flex-col gap-2">
          <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-center text-xs font-semibold text-slate-700 hover:bg-slate-50">
            {uploading ? "Uploading..." : "Replace (upload)"}
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
          <button
            onClick={onPick}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Pick from library
          </button>
        </div>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}

function MediaPicker({
  assets, onSelect, onClose,
}: {
  assets: AssetData[]; onSelect: (url: string) => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-6" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">Media library</h3>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">Close</button>
        </div>
        {assets.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">
            No uploads yet — use “Replace (upload)” on a field, or the Media page.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
            {assets.map((a) => (
              <button
                key={a.id}
                onClick={() => onSelect(a.url)}
                className="group overflow-hidden rounded-lg border border-slate-200 text-left hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt={a.filename} className="h-24 w-full bg-slate-50 object-cover" />
                <span className="block truncate px-2 py-1 text-[11px] text-slate-500">{a.filename}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
