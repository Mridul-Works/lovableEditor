import "server-only";
import { compile } from "@tailwindcss/node";
import { isFieldRef, type TreeNode } from "@/lib/tree";

// Compiles the Tailwind CSS a page's classes need, at import time. The
// build-time Tailwind scan can't see class names stored in the database, so
// each page carries its own compiled stylesheet, injected by the renderer.

// Default shadcn/Lovable-style design tokens so classes like bg-primary and
// text-muted-foreground resolve. A pasted theme CSS (the project's index.css)
// overrides these values.
const DEFAULT_TOKENS = `
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 222.2 84% 4.9%;
  --radius: 0.5rem;
}
@theme {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
}
`;

const CANDIDATE_RE = /^[\w!@:[\]()/%.,#&*=<>~+'"^$?;-]+$/;

export function collectClassCandidates(nodes: TreeNode[], out = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.t !== "e") continue;
    const cls = node.props.className;
    if (typeof cls === "string") {
      for (const token of cls.split(/\s+/)) {
        if (token && token.length < 200 && CANDIDATE_RE.test(token) && !token.includes("</")) {
          out.add(token);
        }
      }
    }
    collectClassCandidates(node.children, out);
  }
  return out;
}

/** Collect image URLs referenced by fields so CSS url() stays intact. */
export function collectBgFieldKeys(nodes: TreeNode[], out = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.t !== "e") continue;
    const style = node.props.style;
    if (style && typeof style === "object" && !isFieldRef(style)) {
      for (const v of Object.values(style)) {
        if (isFieldRef(v)) out.add(v.$f);
      }
    }
    collectBgFieldKeys(node.children, out);
  }
  return out;
}

function sanitizeThemeCss(css: string) {
  return css
    .replace(/@import[^;]*;/g, "")
    .replace(/@tailwind[^;]*;/g, "")
    .replace(/<\/?script/gi, "");
}

export async function compilePageCss(tree: TreeNode[], themeCss?: string): Promise<string> {
  const candidates = [...collectClassCandidates(tree)];

  const input = `
@layer theme, base, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
${DEFAULT_TOKENS}
${themeCss ? sanitizeThemeCss(themeCss) : ""}
`;

  const compiler = await compile(input, {
    base: process.cwd(),
    onDependency: () => undefined,
  });
  const css = compiler.build(candidates);
  // Defense in depth: the CSS is injected via a <style> tag.
  return css.replace(/<\//g, "<\\/");
}
