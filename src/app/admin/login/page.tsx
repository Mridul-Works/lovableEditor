import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/admin/LoginForm";
import { BrandFonts } from "@/components/admin/BrandFonts";
import { Squiggle } from "@/components/admin/PageTitle";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // The authoritative "already signed in?" check lives here rather than in the
  // proxy: the proxy only sees the token's signature, so a revoked session
  // would bounce between here and /admin forever.
  const session = await getSession();
  if (session) redirect("/admin");

  return (
    <main className="admin-ui grid min-h-screen bg-white lg:grid-cols-[1.1fr_1fr]">
      <BrandFonts />
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <div className="leading-none">
          <span className="block text-xl font-semibold lowercase tracking-tight">masters&rsquo; union</span>
          <span className="mt-1 block font-accent text-base font-light italic text-neutral-400">page editor</span>
        </div>
        <div>
          <h1 className="text-6xl font-light leading-[1.05] tracking-tight xl:text-7xl">
            Every page,
            <br />
            <span className="relative inline-block font-accent italic">
              editable
              <Squiggle className="absolute -bottom-2 left-0 h-3.5 w-full" />
            </span>
          </h1>
          <p className="mt-8 max-w-sm text-sm leading-relaxed text-neutral-400">
            Pages built in Lovable, synced from GitHub, with every headline, image and link open to change.
          </p>
        </div>
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-600">Admins only</p>
      </section>
      <section className="flex items-center justify-center bg-mist px-6 py-12">
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
