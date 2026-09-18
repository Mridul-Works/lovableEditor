import Link from "next/link";
import { BrandFonts } from "@/components/admin/BrandFonts";
import { Squiggle } from "@/components/admin/PageTitle";

export default function NotFound() {
  return (
    <main className="admin-ui flex min-h-screen flex-col items-center justify-center gap-5 bg-ink px-6 text-center text-white">
      <BrandFonts />
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">Error 404</p>
      <h1 className="text-5xl font-light tracking-tight md:text-6xl">
        This page isn&apos;t{" "}
        <span className="relative inline-block font-accent italic">
          here
          <Squiggle className="absolute -bottom-2 left-0 h-3 w-full" />
        </span>
      </h1>
      <p className="max-w-sm text-sm text-neutral-400">It may not have been imported or published yet.</p>
      <Link
        href="/"
        className="mt-3 rounded-full border border-white/25 px-6 py-3 text-sm font-medium transition-colors hover:bg-white hover:text-ink"
      >
        Go to the home page
      </Link>
    </main>
  );
}
