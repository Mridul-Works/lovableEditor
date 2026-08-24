import "server-only";
import path from "node:path";
import { db } from "@/lib/db";
import { getBlob, getFileText, type TreeEntry } from "@/lib/github";
import { ALLOWED_IMAGE_TYPES, storage } from "@/lib/storage";

// Given a page file in a Lovable GitHub repo, gather everything the importer
// needs: the page source, every local component it (transitively) imports,
// the project's theme CSS, and the image assets it references (fetched from
// the repo and uploaded to our storage). Sources are concatenated with the
// page file LAST so its `export default` wins.

const MAX_FILES = 60;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

const IMAGE_EXT_TO_TYPE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

// shadcn/ui internals are deliberately NOT bundled — the extractor's passthrough
// mapping (Button → <button> etc.) handles them better than their Radix/cva-heavy
// sources would. Hooks return runtime values and carry no markup.
//
// src/lib IS bundled apart from the shadcn `cn` helper: newer Lovable projects
// keep a page's content there (lib/faculty-stats.ts, lib/campus-radio.ts, ...),
// and skipping it leaves every list and grid on the page empty.
function isBundledSource(repoPath: string) {
  return (
    /\.(tsx|jsx|ts|js)$/.test(repoPath) &&
    !repoPath.includes("/components/ui/") &&
    !/(^|\/)lib\/utils\.(ts|js)$/.test(repoPath) &&
    !repoPath.includes("/hooks/")
  );
}

const IMPORT_RE = /import\s+(?:[\w{}\s,*$]+?\s+from\s+)?['"]([^'"]+)['"]/g;

function resolveSpecifier(spec: string, fromFile: string, paths: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  } else return null; // external package

  const candidates = [
    base,
    `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`,
    `${base}/index.tsx`, `${base}/index.ts`,
  ];
  for (const c of candidates) if (paths.has(c)) return c;
  return null;
}

export type RepoBundle = {
  source: string;
  themeCss?: string;
  tailwindConfig?: string;
  indexHtml?: string;
  assetUrls: Map<string, string>;
  filesBundled: string[];
  assetsUploaded: string[];
  /** True when MAX_FILES stopped the crawl before every import was followed. */
  truncated: boolean;
};

export type RepoRef = { token: string; owner: string; repo: string; branch: string };

export async function bundlePageFromRepo(
  ref: RepoRef,
  entryPath: string,
  tree: TreeEntry[],
): Promise<RepoBundle> {
  const paths = new Set(tree.map((e) => e.path));
  const byPath = new Map(tree.map((e) => [e.path, e]));
  if (!paths.has(entryPath)) throw new Error(`${entryPath} not found in the repository.`);

  const sources = new Map<string, string>(); // repoPath → content
  const assetUrls = new Map<string, string>(); // specifier as written → uploaded URL
  const assetsUploaded: string[] = [];
  const queue = [entryPath];
  const visited = new Set<string>();

  while (queue.length > 0 && visited.size < MAX_FILES) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const content = await getFileText(ref.token, ref.owner, ref.repo, current, ref.branch);
    sources.set(current, content);

    for (const match of content.matchAll(IMPORT_RE)) {
      const spec = match[1];
      const resolved = resolveSpecifier(spec, current, paths);
      if (!resolved) continue;

      const ext = path.posix.extname(resolved).toLowerCase();
      if (IMAGE_EXT_TO_TYPE[ext]) {
        if (!assetUrls.has(spec)) {
          const url = await uploadRepoAsset(ref, byPath.get(resolved)!, ext);
          if (url) {
            assetUrls.set(spec, url);
            assetsUploaded.push(resolved);
          }
        }
        continue;
      }

      if (isBundledSource(resolved) && !visited.has(resolved)) queue.push(resolved);
    }
  }

  // Theme CSS: Lovable keeps design tokens in src/index.css (Vite template)
  // or src/styles.css (TanStack Start template, Tailwind v4 @theme blocks).
  let themeCss: string | undefined;
  for (const cssPath of ["src/index.css", "src/styles.css", "src/App.css", "src/styles/globals.css"]) {
    if (paths.has(cssPath)) {
      themeCss = await getFileText(ref.token, ref.owner, ref.repo, cssPath, ref.branch);
      break;
    }
  }

  // Self-hosted public/ assets referenced by absolute paths — fonts in
  // @font-face ("/fonts/x.ttf") and images used as src="/lovable-uploads/y.png".
  // Fetch them from the repo's public/ dir and rewrite to our storage.
  const PUBLIC_REF_RE = /["'(](\/[\w\-./]+\.(png|jpe?g|webp|gif|svg|avif|ttf|otf|woff2?))["')]/gi;
  const publicUrlMap = new Map<string, string>();
  for (const content of [...sources.values(), themeCss ?? ""]) {
    for (const m of content.matchAll(PUBLIC_REF_RE)) {
      const urlPath = m[1];
      if (publicUrlMap.has(urlPath)) continue;
      const entry = byPath.get("public" + urlPath);
      if (!entry) continue;
      const url = await uploadRepoAsset(ref, entry, path.posix.extname(urlPath).toLowerCase());
      if (url) {
        publicUrlMap.set(urlPath, url);
        assetsUploaded.push("public" + urlPath);
      }
    }
  }
  for (const [p, url] of publicUrlMap) assetUrls.set(p, url);
  if (themeCss) {
    for (const [p, url] of publicUrlMap) themeCss = themeCss.split(p).join(url);
  }

  // Custom design tokens (colors, gradients, shadows, animations) live in
  // tailwind.config — Tailwind v4 projects have none and use @theme in CSS.
  let tailwindConfig: string | undefined;
  for (const cfgPath of ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs"]) {
    if (paths.has(cfgPath)) {
      tailwindConfig = await getFileText(ref.token, ref.owner, ref.repo, cfgPath, ref.branch);
      break;
    }
  }
  // Google Fonts links live in index.html (Vite template). TanStack Start has
  // no index.html — the same <link> tags are declared as head objects on the
  // root route, and googleFontImports() reads either shape.
  let indexHtml: string | undefined;
  for (const headPath of ["index.html", "src/routes/__root.tsx"]) {
    if (paths.has(headPath)) {
      indexHtml = await getFileText(ref.token, ref.owner, ref.repo, headPath, ref.branch);
      break;
    }
  }

  // Concatenate: components first, entry last (its default export must win).
  const parts: string[] = [];
  for (const [p, content] of sources) {
    if (p !== entryPath) parts.push(`// ===== ${p} =====\n${content}`);
  }
  parts.push(`// ===== ${entryPath} (page) =====\n${sources.get(entryPath)!}`);

  return {
    source: parts.join("\n\n"),
    themeCss,
    tailwindConfig,
    indexHtml,
    assetUrls,
    filesBundled: [...sources.keys()],
    assetsUploaded,
    truncated: queue.length > 0,
  };
}

async function uploadRepoAsset(ref: RepoRef, entry: TreeEntry, ext: string): Promise<string | null> {
  if ((entry.size ?? 0) > MAX_ASSET_BYTES) return null;
  const contentType = IMAGE_EXT_TO_TYPE[ext];
  if (!contentType || !ALLOWED_IMAGE_TYPES[contentType]) return null;
  try {
    const buffer = await getBlob(ref.token, ref.owner, ref.repo, entry.sha);
    const stored = await storage.put(buffer, path.posix.basename(entry.path), contentType);

    let width: number | null = null;
    let height: number | null = null;
    try {
      const { imageSize } = await import("image-size");
      const dim = imageSize(buffer);
      width = dim.width ?? null;
      height = dim.height ?? null;
    } catch { /* dimensions best-effort */ }

    await db.mediaAsset.upsert({
      where: { url: stored.url },
      create: { url: stored.url, filename: stored.filename, width, height, size: stored.size },
      update: {},
    });
    return stored.url;
  } catch {
    return null;
  }
}

/**
 * Candidate page files in a Lovable repo. Two project templates are in the
 * wild and both are supported:
 *   - Vite + React Router: pages in src/pages/, single src/App.tsx fallback.
 *   - TanStack Start: file-based routes in src/routes/ (see isRouteFile).
 */
export function findPageFiles(tree: TreeEntry[]): string[] {
  const all = tree.map((e) => e.path);

  const pages = all
    .filter((p) => /^src\/pages\/[^/]+\.(tsx|jsx)$/.test(p) && !/NotFound\.(tsx|jsx)$/i.test(p))
    .sort((a, b) => (a.includes("Index.") ? -1 : 0) - (b.includes("Index.") ? -1 : 0) || a.localeCompare(b));
  if (pages.length > 0) return pages;

  const routes = all
    .filter(isRouteFile)
    .sort((a, b) => (isRouteIndex(a) ? -1 : 0) - (isRouteIndex(b) ? -1 : 0) || a.localeCompare(b));
  if (routes.length > 0) return routes;

  return all.filter((p) => /^src\/App\.(tsx|jsx)$/.test(p));
}

/**
 * A TanStack Start route file that renders an actual page. Excluded:
 *   __root.tsx / __*.tsx  – root wrappers
 *   route.tsx             – pathless layouts (they render an <Outlet />)
 *   -foo/bar.tsx          – a leading "-" marks a non-route file
 *   posts/$postId.tsx     – dynamic segments have no single static route,
 *                           so they can't be represented as an editor page
 */
function isRouteFile(p: string): boolean {
  if (!/^src\/routes\/.+\.(tsx|jsx)$/.test(p)) return false;
  const rel = p.slice("src/routes/".length);
  if (rel.includes("$")) return false;
  const segments = rel.replace(/\.(tsx|jsx)$/, "").split(/[/.]/);
  if (segments.some((s) => s.startsWith("__") || s.startsWith("-"))) return false;
  const last = segments[segments.length - 1];
  return last !== "route" && !/^(notfound|not-found|404)$/i.test(last);
}

function isRouteIndex(p: string): boolean {
  return /(^|[/.])index\.(tsx|jsx)$/.test(p);
}

/**
 * Suggested route for a page file.
 *   src/pages/AboutUs.tsx                 → /about-us
 *   src/routes/index.tsx                  → /
 *   src/routes/programmes.pg.pgp-tbm.tsx  → /programmes/pg/pgp-tbm
 */
export function suggestRoute(pagePath: string): string {
  if (/^src\/routes\//.test(pagePath)) return routeFromFileRoute(pagePath);
  const name = path.posix.basename(pagePath).replace(/\.(tsx|jsx)$/, "");
  if (name === "Index" || name === "App" || name === "Home") return "/";
  return (
    "/" +
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
      .toLowerCase()
  );
}

/**
 * TanStack Start encodes nesting two equivalent ways — directories and dots —
 * so "a/b.c.tsx" and "a.b.c.tsx" are both /a/b/c. A trailing "index" and any
 * pathless "_layout" segment contribute no path of their own.
 */
function routeFromFileRoute(pagePath: string): string {
  const rel = pagePath
    .slice("src/routes/".length)
    .replace(/\.(tsx|jsx)$/, "")
    .replace(/\.lazy$/, "");
  const segments = rel
    .split(/[/.]/)
    .filter((s) => s && s !== "index" && !s.startsWith("_"));
  return "/" + segments.join("/").toLowerCase();
}
