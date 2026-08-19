import { ImportForm } from "@/components/admin/ImportForm";

export default function ImportPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold">Import a page</h1>
      <p className="mb-6 text-sm text-slate-500">
        Paste the page component exported from Lovable (TSX/JSX). It is parsed as data — the code
        is never executed. Interactive behavior (state, handlers) is stripped by design; structure,
        styling, text and images are preserved and become editable.
      </p>
      <ImportForm />
    </div>
  );
}
