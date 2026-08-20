import "server-only";
import { compile } from "@tailwindcss/node";
import { isFieldRef, type TreeNode } from "@/lib/tree";
import { tailwindConfigToCss } from "./tw-config";

// Compiles the Tailwind CSS a page's classes need, at import time. The
// build-time Tailwind scan can't see class names stored in the database, so
// each page carries its own compiled stylesheet, injected by the renderer.

// shadcn variable names Lovable themes define. Defaults below are neutral;
// a project's own index.css (same names, later in the sheet) overrides them.
const SHADCN_VARS: Record<string, string> = {
  background: "0 0% 100%",
  foreground: "222.2 84% 4.9%",
  card: "0 0% 100%",
  "card-foreground": "222.2 84% 4.9%",
  popover: "0 0% 100%",
  "popover-foreground": "222.2 84% 4.9%",
  primary: "222.2 47.4% 11.2%",
  "primary-foreground": "210 40% 98%",
  secondary: "210 40% 96.1%",
  "secondary-foreground": "222.2 47.4% 11.2%",
  muted: "210 40% 96.1%",
  "muted-foreground": "215.4 16.3% 46.9%",
  accent: "210 40% 96.1%",
  "accent-foreground": "222.2 47.4% 11.2%",
  destructive: "0 84.2% 60.2%",
  "destructive-foreground": "210 40% 98%",
  border: "214.3 31.8% 91.4%",
  input: "214.3 31.8% 91.4%",
  ring: "222.2 84% 4.9%",
};

/**
 * shadcn themes traditionally store raw HSL triplets ("222 47% 11%") that get
 * wrapped in hsl(); newer ones store complete colors (oklch(...), #hex).
 * Wrapping a complete color in hsl() breaks it, so detect per variable.
 */
function isFullColor(value: string) {
  return /^(#|rgb|hsl|oklch|oklab|lab|lch|color\()/i.test(value.trim());
}

function shadcnThemeBlocks(themeCss: string | undefined) {
  const defined = new Map<string, string>();
  if (themeCss) {
    for (const m of themeCss.matchAll(/--([\w-]+)\s*:\s*([^;{}]+);/g)) {
      if (!defined.has(m[1])) defined.set(m[1], m[2].trim());
    }
  }

  const rootVars: string[] = [];
  const themeTokens: string[] = [];
  for (const [name, fallback] of Object.entries(SHADCN_VARS)) {
    rootVars.push(`  --${name}: ${fallback};`);
    const projectValue = defined.get(name);
    const full = projectValue !== undefined ? isFullColor(projectValue) : false;
    themeTokens.push(`  --color-${name}: ${full ? `var(--${name})` : `hsl(var(--${name}))`};`);
  }
  if (!defined.has("radius")) rootVars.push("  --radius: 0.5rem;");

  // Defaults live in @layer base so a project's own `@layer base { :root {...} }`
  // (later in the sheet) — or an unlayered :root — wins over them.
  return `
@layer base {
  :root {
${rootVars.join("\n")}
  }
}
@theme {
${themeTokens.join("\n")}
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
}
`;
}

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

function sanitizeCssInput(css: string) {
  return css
    .replace(/@import[^;]*;/g, "")
    .replace(/@tailwind[^;]*;/g, "")
    .replace(/<\/?script/gi, "");
}

/** Google Fonts stylesheets referenced by the project's index.html. */
function googleFontImports(indexHtml: string | undefined): string[] {
  if (!indexHtml) return [];
  const urls = new Set<string>();
  for (const m of indexHtml.matchAll(/href=["'](https:\/\/fonts\.googleapis\.com\/css2?[^"']+)["']/g)) {
    urls.add(m[1].replace(/&amp;/g, "&"));
  }
  return [...urls].map((u) => `@import url("${u}");`);
}

export type CompileCssOptions = {
  /** The project's index.css (theme variables). */
  themeCss?: string;
  /** The project's tailwind.config.ts/js source — translated, not executed. */
  tailwindConfig?: string;
  /** The project's index.html — mined for Google Fonts links. */
  indexHtml?: string;
};

export async function compilePageCss(tree: TreeNode[], options?: CompileCssOptions): Promise<string> {
  const candidates = [...collectClassCandidates(tree)];
  const configCss = options?.tailwindConfig ? tailwindConfigToCss(options.tailwindConfig) : "";

  const input = `
@layer theme, base, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
${shadcnThemeBlocks(options?.themeCss)}
${configCss}
${options?.themeCss ? sanitizeCssInput(options.themeCss) : ""}
`;

  const compiler = await compile(input, {
    base: process.cwd(),
    onDependency: () => undefined,
  });
  const fontImports = googleFontImports(options?.indexHtml);
  const css = fontImports.join("\n") + "\n" + compiler.build(candidates);
  // Defense in depth: the CSS is injected via a <style> tag.
  return css.replace(/<\//g, "<\\/");
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
