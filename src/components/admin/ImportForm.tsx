"use client";

import Link from "next/link";
import { useActionState } from "react";
import { importPageAction, type ImportState } from "@/lib/actions";

export function ImportForm() {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(importPageAction, {});
  const report = state.report;

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Target route</span>
            <input
              name="route"
              required
              placeholder="/pricing"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Title <span className="text-slate-400">(optional)</span></span>
            <input
              name="title"
              placeholder="Derived from the page's first heading"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Page component code</span>
          <textarea
            name="source"
            rows={14}
            placeholder="Paste the exported TSX here..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">...or upload the file</span>
            <input
              name="file"
              type="file"
              accept=".tsx,.jsx,.ts,.js,text/plain"
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
            />
          </label>
        </div>

        <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">
            Exact design match (optional — paste the project&apos;s index.css and tailwind.config.ts)
          </summary>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">src/index.css (theme variables)</span>
            <textarea
              name="themeCss"
              rows={5}
              placeholder=":root { --primary: 262 83% 58%; ... }"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
            />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">tailwind.config.ts (custom colors, gradients, shadows, animations)</span>
            <textarea
              name="tailwindConfig"
              rows={5}
              placeholder="export default { theme: { extend: { ... } } }"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
            />
          </label>
        </details>

        {state.error ? (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {pending ? "Importing..." : "Import page"}
        </button>
      </form>

      {report ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
          <h2 className="text-lg font-bold text-emerald-900">
            {state.reimported ? "Re-import complete" : "Import complete"} — {state.route}
          </h2>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Text fields" value={report.textFields} />
            <Stat label="Image fields" value={report.imageFields} />
            {report.merge ? (
              <>
                <Stat label="Kept (edits preserved)" value={report.merge.kept} />
                <Stat label="Added" value={report.merge.added} />
                <Stat label="Orphaned" value={report.merge.orphaned} />
              </>
            ) : null}
            <Stat label="Icons rendered" value={report.renderedIcons.length} />
          </dl>

          {report.unknownComponents.length > 0 ? (
            <ReportList title="Unknown components (rendered as passthrough)" items={report.unknownComponents} />
          ) : null}
          {report.strippedHandlers.length > 0 ? (
            <ReportList title="Stripped event handlers" items={report.strippedHandlers} />
          ) : null}
          {report.droppedExpressions.length > 0 ? (
            <ReportList title="Dropped dynamic expressions" items={report.droppedExpressions} mono />
          ) : null}
          {report.notes.length > 0 ? <ReportList title="Notes" items={report.notes} /> : null}

          <div className="mt-6 flex gap-3">
            <Link
              href={`/admin/pages/${state.pageId}`}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
            >
              Open editor
            </Link>
            <a
              href={state.route}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              View page (draft)
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2">
      <dt className="text-xs text-emerald-700">{label}</dt>
      <dd className="text-xl font-bold text-emerald-900 tabular-nums">{value}</dd>
    </div>
  );
}

function ReportList({ title, items, mono }: { title: string; items: string[]; mono?: boolean }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-emerald-900">{title}</h3>
      <ul className={`mt-1 list-inside list-disc text-sm text-emerald-800 ${mono ? "font-mono text-xs" : ""}`}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
