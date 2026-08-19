import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
      <p className="text-6xl font-black text-slate-300">404</p>
      <h1 className="text-xl font-bold text-slate-900">This page doesn&apos;t exist</h1>
      <p className="text-sm text-slate-500">It may not have been imported or published yet.</p>
      <Link href="/" className="mt-2 text-sm font-semibold text-indigo-600 hover:underline">
        Go home
      </Link>
    </main>
  );
}
