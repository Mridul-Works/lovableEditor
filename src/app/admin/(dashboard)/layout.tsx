import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { QueryProvider } from "@/lib/query-client";
import { AdminNav } from "@/components/admin/AdminNav";
import { BrandFonts } from "@/components/admin/BrandFonts";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // The proxy gates /admin on the token's signature alone, which cannot see a
  // revoked session. This is the authoritative check: it hits the database and
  // rejects tokens issued before the admin last signed out.
  const session = await getSession();
  if (!session) redirect("/admin/login");

  return (
    <div className="admin-ui flex min-h-screen bg-mist">
      <BrandFonts />
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-ink text-white">
        <div className="px-6 pb-5 pt-7">
          <Link href="/admin" className="block leading-none">
            <span className="block text-[19px] font-semibold lowercase tracking-tight">masters&rsquo; union</span>
            <span className="mt-1 block font-accent text-[15px] font-light italic text-neutral-400">page editor</span>
          </Link>
        </div>
        <AdminNav />
        <div className="border-t border-white/10 p-4 text-xs">
          <p className="truncate px-2 pb-3 text-neutral-500" title={session.email}>{session.email}</p>
          <form action={logoutAction}>
            <button className="w-full rounded-full border border-white/15 px-4 py-2 text-left font-medium text-neutral-200 transition-colors hover:bg-white hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">
        <QueryProvider>{children}</QueryProvider>
      </main>
    </div>
  );
}
