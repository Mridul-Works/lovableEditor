import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // The proxy gates /admin on the token's signature alone, which cannot see a
  // revoked session. This is the authoritative check: it hits the database and
  // rejects tokens issued before the admin last signed out.
  const session = await getSession();
  if (!session) redirect("/admin/login");

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <Link href="/admin" className="text-lg font-bold tracking-tight">
            Lovable<span className="text-indigo-600">Editor</span>
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3 text-sm font-medium">
          <Link href="/admin" className="rounded-lg px-3 py-2 hover:bg-slate-100">Pages</Link>
          <Link href="/admin/projects" className="rounded-lg px-3 py-2 hover:bg-slate-100">Lovable projects</Link>
          <Link href="/admin/import" className="rounded-lg px-3 py-2 hover:bg-slate-100">Paste import</Link>
          <Link href="/admin/media" className="rounded-lg px-3 py-2 hover:bg-slate-100">Media</Link>
        </nav>
        <div className="border-t border-slate-200 p-3 text-xs text-slate-500">
          <p className="truncate px-3 pb-2" title={session.email}>{session.email}</p>
          <form action={logoutAction}>
            <button className="w-full rounded-lg px-3 py-2 text-left font-medium text-slate-700 hover:bg-slate-100">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">{children}</main>
    </div>
  );
}
