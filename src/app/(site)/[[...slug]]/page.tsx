import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RenderTree } from "@/components/RenderTree";
import { EditOverlay } from "@/components/EditOverlay";
import { PreviewBridge } from "@/components/PreviewBridge";
import { QueryProvider } from "@/lib/query-client";
import { BrandFonts } from "@/components/admin/BrandFonts";
import { Squiggle } from "@/components/admin/PageTitle";
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
  // The admin editor loads the page in an iframe with ?preview=1: no banner,
  // no overlay, just the page plus the bridge that applies live edits.
  const previewMode = session !== null && sp.preview === "1";

  return (
    <>
      {page.compiledCss ? (
        // Compiled by Tailwind at import time from the page's class list —
        // sanitized, and never sourced from raw user markup.
        <style dangerouslySetInnerHTML={{ __html: page.compiledCss }} />
      ) : null}

      {session && !previewMode && page.status !== PAGE_STATUS.PUBLISHED ? (
        <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-sun px-4 py-2 font-brand text-sm font-medium text-ink">
          Draft — only admins can see this page.
          <Link href={`/admin/pages/${page.id}`} className="underline">Open in editor</Link>
        </div>
      ) : null}

      <RenderTree tree={pageTree(page)} values={values} />

      {previewMode ? <PreviewBridge /> : null}
      {editMode && !previewMode ? (
        <QueryProvider>
          <EditOverlay route={route} pageId={page.id} />
        </QueryProvider>
      ) : null}
    </>
  );
}

function WelcomePage({ isAdmin }: { isAdmin: boolean }) {
  return (
    <main className="admin-ui flex min-h-screen flex-col items-center justify-center gap-6 bg-ink px-6 text-center text-white">
      <BrandFonts />
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">masters&rsquo; union page editor</p>
      <h1 className="text-5xl font-light tracking-tight md:text-6xl">
        Nothing is{" "}
        <span className="relative inline-block font-accent italic">
          published
          <Squiggle className="absolute -bottom-2 left-0 h-3 w-full" />
        </span>{" "}
        here yet
      </h1>
      <p className="max-w-md text-sm text-neutral-400">
        No page has been imported at <code className="rounded bg-white/10 px-1.5 py-0.5">/</code>. Sync a Lovable
        project and its home page appears here.
      </p>
      <Link
        href={isAdmin ? "/admin/projects" : "/admin/login"}
        className="rounded-full bg-white px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-sun"
      >
        {isAdmin ? "Open Lovable projects" : "Sign in"}
      </Link>
    </main>
  );
}
