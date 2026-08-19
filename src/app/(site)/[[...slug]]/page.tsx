import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RenderTree } from "@/components/RenderTree";
import { EditOverlay } from "@/components/EditOverlay";
import { getSession } from "@/lib/auth";
import {
  PAGE_STATUS,
  fieldValues,
  getPageCached,
  getPageFresh,
  pageTree,
} from "@/lib/pages";
import { FIELD_META_DESCRIPTION, FIELD_META_TITLE } from "@/lib/tree";

type Props = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function routeFromSlug(slug?: string[]) {
  return "/" + (slug?.join("/") ?? "");
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const route = routeFromSlug((await params).slug);
  const page = await getPageCached(route);
  if (!page) return {};
  const values = fieldValues(page);
  return {
    title: values[FIELD_META_TITLE] || page.title,
    description: values[FIELD_META_DESCRIPTION] || undefined,
  };
}

export default async function SitePage({ params, searchParams }: Props) {
  const route = routeFromSlug((await params).slug);
  const sp = await searchParams;
  const session = await getSession();

  // Admins read fresh (drafts, instant preview); public traffic reads the
  // tag-cached copy that every save invalidates.
  const page = session ? await getPageFresh(route) : await getPageCached(route);

  if (!page || (!session && page.status !== PAGE_STATUS.PUBLISHED)) {
    if (route === "/") return <WelcomePage isAdmin={session !== null} />;
    notFound();
  }

  const values = fieldValues(page);
  const editMode = session !== null && sp.edit === "1";

  return (
    <>
      {page.compiledCss ? (
        // Compiled by Tailwind at import time from the page's class list —
        // sanitized, and never sourced from raw user markup.
        <style dangerouslySetInnerHTML={{ __html: page.compiledCss }} />
      ) : null}

      {session && page.status !== PAGE_STATUS.PUBLISHED ? (
        <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950">
          Draft — only admins can see this page.
          <Link href={`/admin/pages/${page.id}`} className="underline">Open in editor</Link>
        </div>
      ) : null}

      <RenderTree tree={pageTree(page)} values={values} />

      {editMode ? <EditOverlay route={route} /> : null}
    </>
  );
}

function WelcomePage({ isAdmin }: { isAdmin: boolean }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-6 text-center text-slate-50">
      <h1 className="text-4xl font-bold tracking-tight">LovableEditor</h1>
      <p className="max-w-md text-slate-400">
        No page has been imported at <code className="rounded bg-slate-800 px-1.5 py-0.5">/</code> yet.
        Import a page from Lovable to publish it here.
      </p>
      <Link
        href={isAdmin ? "/admin/import" : "/admin/login"}
        className="rounded-lg bg-slate-50 px-5 py-2.5 font-semibold text-slate-950 hover:bg-slate-200"
      >
        {isAdmin ? "Import a page" : "Admin login"}
      </Link>
    </main>
  );
}
