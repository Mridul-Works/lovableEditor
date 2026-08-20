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

// shadcn/ui internals and utils are deliberately NOT bundled — the extractor's
// passthrough mapping (Button → <button> etc.) handles them better than their
// Radix/cva-heavy sources would.
function isBundledSource(repoPath: string) {
  return (
    /\.(tsx|jsx|ts|js)$/.test(repoPath) &&
    !repoPath.includes("/components/ui/") &&
    !repoPath.includes("/lib/") &&
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

  // Theme CSS: Lovable keeps design tokens in src/index.css.
  let themeCss: string | undefined;
  for (const cssPath of ["src/index.css", "src/App.css", "src/styles/globals.css"]) {
    if (paths.has(cssPath)) {
      themeCss = await getFileText(ref.token, ref.owner, ref.repo, cssPath, ref.branch);
      break;
    }
  }

  // Custom design tokens (colors, gradients, shadows, animations) live in
  // tailwind.config; Google Fonts links live in index.html.
  let tailwindConfig: string | undefined;
  for (const cfgPath of ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs"]) {
    if (paths.has(cfgPath)) {
      tailwindConfig = await getFileText(ref.token, ref.owner, ref.repo, cfgPath, ref.branch);
      break;
    }
  }
  let indexHtml: string | undefined;
  if (paths.has("index.html")) {
    indexHtml = await getFileText(ref.token, ref.owner, ref.repo, "index.html", ref.branch);
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

/** Candidate page files in a Lovable repo (src/pages/*.tsx, App.tsx fallback). */
export function findPageFiles(tree: TreeEntry[]): string[] {
  const pages = tree
    .map((e) => e.path)
    .filter((p) => /^src\/pages\/[^/]+\.(tsx|jsx)$/.test(p) && !/NotFound\.(tsx|jsx)$/i.test(p))
    .sort((a, b) => (a.includes("Index.") ? -1 : 0) - (b.includes("Index.") ? -1 : 0) || a.localeCompare(b));
  if (pages.length > 0) return pages;
  return tree.map((e) => e.path).filter((p) => /^src\/App\.(tsx|jsx)$/.test(p));
}

/** Suggested route for a page file: Index → /, AboutUs → /about-us. */
export function suggestRoute(pagePath: string): string {
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
