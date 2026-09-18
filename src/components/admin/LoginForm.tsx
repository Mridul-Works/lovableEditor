"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { loginAction, type LoginState } from "@/lib/actions";

const field =
  "w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 outline-none transition-shadow focus:border-ink focus:ring-2 focus:ring-sun/60";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="w-full max-w-sm space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500 lg:hidden">masters&rsquo; union</p>
        <h2 className="mt-1 text-3xl font-light tracking-tight text-ink">Sign in</h2>
        <p className="mt-2 text-sm text-neutral-500">Use your editor account to manage pages.</p>
      </div>
      <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-neutral-600">Email</span>
        <input name="email" type="email" required autoComplete="email" className={field} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-neutral-600">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className={field} />
      </label>
      {state.error ? <p className="rounded-xl bg-alert/10 px-4 py-3 text-sm text-alert">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-ink py-3.5 font-medium text-white transition-colors hover:bg-coal disabled:opacity-50"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
