"use client";

import { useActionState } from "react";
import { connectGithubAction, type ConnectState } from "@/lib/actions";

export function ConnectGithubForm() {
  const [state, formAction, pending] = useActionState<ConnectState, FormData>(connectGithubAction, {});

  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6">
      <ol className="list-inside list-decimal space-y-1 text-sm text-neutral-600">
        <li>
          In Lovable: <strong>GitHub button (top right) → Connect → Create repository</strong> — your
          project code is now on GitHub and stays in sync.
        </li>
        <li>
          On GitHub, create a token at{" "}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
            className="text-leaf underline"
          >
            Settings → Developer settings → Fine-grained tokens
          </a>
          {" "}with <strong>read-only Contents &amp; Metadata</strong> access to your repositories.
        </li>
        <li>Paste the token below.</li>
      </ol>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">GitHub personal access token</span>
        <input
          name="token"
          type="password"
          required
          placeholder="github_pat_… or ghp_…"
          autoComplete="off"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-ink focus:ring-2 focus:ring-sun/60"
        />
      </label>
      {state.error ? <p className="text-sm text-alert">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-coal disabled:opacity-50"
      >
        {pending ? "Checking token..." : "Connect GitHub"}
      </button>
      <p className="text-xs text-neutral-400">
        The token is stored in this app&apos;s own database and only used server-side to read your
        repositories. Alternatively set GITHUB_TOKEN in .env.
      </p>
    </form>
  );
}
