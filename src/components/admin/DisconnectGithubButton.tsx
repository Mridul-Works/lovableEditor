"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { disconnectGithubAction } from "@/lib/actions";

export function DisconnectGithubButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await disconnectGithubAction();
          router.refresh();
        })
      }
      disabled={pending}
      className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
    >
      {pending ? "Disconnecting..." : "Disconnect GitHub"}
    </button>
  );
}
