import { ImportForm } from "@/components/admin/ImportForm";
import { PageTitle } from "@/components/admin/PageTitle";

export default function ImportPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-4"><PageTitle lead="Paste" accent="import" /></div>
      <p className="mb-2 text-sm text-neutral-500">
        Paste the page component exported from Lovable (TSX/JSX). It is parsed as data — the code
        is never executed. Interactive behavior (state, handlers) is stripped by design; structure,
        styling, text and images are preserved and become editable.
      </p>
      <p className="mb-6 rounded-xl bg-sun/15 px-4 py-3 text-sm text-ink">
        <strong>Page split into components?</strong> If your page file just renders
        <code className="mx-1 rounded bg-sun/40 px-1">&lt;Header /&gt;&lt;Hero /&gt;...</code>,
        paste the page file <em>plus each component file&apos;s code</em> below, one after another,
        all in this same box. The importer stitches them together automatically.
      </p>
      <ImportForm />
    </div>
  );
}
