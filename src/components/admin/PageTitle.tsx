import type { ReactNode } from "react";

// The one flourish in the admin UI, borrowed from mastersunion.org's
// "Learn by Doing": a page title whose last word is set in light italic
// Fraunces with the brand's gradient squiggle beneath it.

export function Squiggle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden className={className}>
      <defs>
        <linearGradient id="mu-squiggle" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0.06" stopColor="#39B6D8" />
          <stop offset="0.51" stopColor="#F7D344" />
          <stop offset="0.97" stopColor="#E38330" />
        </linearGradient>
      </defs>
      <path
        d="M2 8 C 10 2, 16 2, 22 7 S 34 11, 40 5 S 54 2, 60 7 S 74 11, 82 5 S 100 3, 118 6"
        fill="none"
        stroke="url(#mu-squiggle)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PageTitle({
  lead,
  accent,
  sub,
  size = "md",
}: {
  lead?: string;
  accent: string;
  sub?: ReactNode;
  size?: "md" | "lg";
}) {
  const scale = size === "lg" ? "text-4xl md:text-5xl" : "text-3xl";
  return (
    <div>
      <h1 className={`${scale} font-light leading-tight tracking-tight`}>
        {lead ? <>{lead} </> : null}
        <span className="relative inline-block font-accent font-light italic">
          {accent}
          <Squiggle className="absolute -bottom-1.5 left-0 h-2.5 w-full" />
        </span>
      </h1>
      {sub ? <p className="mt-3 text-sm text-neutral-500">{sub}</p> : null}
    </div>
  );
}
