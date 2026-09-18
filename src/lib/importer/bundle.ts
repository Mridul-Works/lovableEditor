import "server-only";
import path from "node:path";
import { db } from "@/lib/db";
import type { TreeEntry } from "@/lib/github";
import { apiReader, type RepoReader } from "./snapshot";
import { ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES, storage } from "@/lib/storage";

// Given a page file in a Lovable GitHub repo, gather everything the importer
// needs: the page source, every local component it (transitively) imports,
// the project's theme CSS, and the media assets it references (fetched from
// the repo or from Lovable's asset host and uploaded to our storage). Sources
// are concatenated with the page file LAST so its `export default` wins.

const MAX_FILES = 60;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 12 * 1024 * 1024;
const ASSET_CONCURRENCY = 6;
const REMOTE_TIMEOUT_MS = 25_000;

const IMAGE_EXT_TO_TYPE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

const VIDEO_EXT_TO_TYPE: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
};

const MEDIA_EXT_TO_TYPE: Record<string, string> = { ...IMAGE_EXT_TO_TYPE, ...VIDEO_EXT_TO_TYPE };

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

/**
 * Newer Lovable projects keep binary assets out of git: the repo holds a JSON
 * sidecar (`hero.webp.asset.json`) describing a file hosted by Lovable, and
 * code imports the sidecar and reads `.url` off it.
 */
const SIDECAR_RE = /\.asset\.json$/i;

const IMPORT_RE = /import\s+(?:[\w{}\s,*$]+?\s+from\s+)?['"]([^'"]+)['"]/g;

/** `import rawMasters from "./meet-masters-data.json";` — a default import of data. */
const JSON_IMPORT_RE = /import\s+(\w+)\s+from\s+['"]([^'"]+\.json)['"]\s*;?/g;
const MAX_JSON_BYTES = 3 * 1024 * 1024;

/**
 * `import.meta.glob("/src/assets/x/*.asset.json", { eager: true, import: "default" })`
 * Vite resolves this to an object keyed by file path. Lovable galleries use
 * it to map a name in a data file to its photo.
 */
const GLOB_RE = /import\.meta\.glob(?:<[^>()]*>)?\(\s*(["'][^"']+["']|\[[^\]]*\])\s*(?:,\s*(\{[^}]*\}))?\s*,?\s*\)/g;

/** Turn a Vite glob into a RegExp over repo paths (no leading slash). */
export function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .replace(/^\.?\//, "")
    .split("**").map((part) => part.split("*").map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

/** Vite keys glob results by the path as the pattern spelled it: absolute or relative. */
export function globKey(pattern: string, repoPath: string, fromFile: string): string {
  if (pattern.startsWith("/")) return "/" + repoPath;
  let rel = path.posix.relative(path.posix.dirname(fromFile), repoPath);
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

/** Match a glob (possibly relative to the importing file) against the repo tree. */
export function expandGlob(pattern: string, fromFile: string, paths: Iterable<string>): string[] {
  const abs = pattern.startsWith("/")
    ? pattern.slice(1)
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), pattern));
  const re = globToRegExp(abs);
  return [...paths].filter((p) => re.test(p)).sort();
}

function resolveSpecifier(spec: string, fromFile: string, paths: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  } else return null; // external package

  // `?url` / `?raw` query suffixes are Vite import hints, not part of the path.
  base = base.replace(/\?.*$/, "");

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
  /** Assets left pointing at Lovable's host (videos, oversized files). */
  assetsRemote: string[];
  /** True when MAX_FILES stopped the crawl before every import was followed. */
  truncated: boolean;
};

export type RepoRef = { token: string; owner: string; repo: string; branch: string };

type AssetRequest = { spec: string; resolved: string };

export async function bundlePageFromRepo(
  ref: RepoRef,
  entryPath: string,
  tree: TreeEntry[],
  /** Where file contents come from; defaults to per-file GitHub API reads. */
  reader: RepoReader = apiReader(ref.token, ref.owner, ref.repo, ref.branch),
): Promise<RepoBundle> {
  const paths = new Set(tree.map((e) => e.path));
  const byPath = new Map(tree.map((e) => [e.path, e]));
  if (!paths.has(entryPath)) throw new Error(`${entryPath} not found in the repository.`);

  const sources = new Map<string, string>(); // repoPath → content
  const assetRequests = new Map<string, AssetRequest>(); // specifier as written → request
  const globRequests: Array<{ file: string; text: string; patterns: string[]; options: string; matches: string[] }> = [];
  const queue = [entryPath];
  const visited = new Set<string>();

  while (queue.length > 0 && visited.size < MAX_FILES) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    let content = await reader.text(current);

    for (const match of content.matchAll(IMPORT_RE)) {
      const spec = match[1];
      const resolved = resolveSpecifier(spec, current, paths);
      if (!resolved) continue;

      const ext = path.posix.extname(resolved).toLowerCase();
      if (SIDECAR_RE.test(resolved) || MEDIA_EXT_TO_TYPE[ext]) {
        if (!assetRequests.has(spec)) assetRequests.set(spec, { spec, resolved });
        continue;
      }

      if (isBundledSource(resolved) && !visited.has(resolved)) queue.push(resolved);
    }

    // Data files: inline the JSON as a const so the extractor can read it.
    for (const m of [...content.matchAll(JSON_IMPORT_RE)]) {
      const [statement, local, spec] = m;
      const resolved = resolveSpecifier(spec, current, paths);
      if (!resolved || SIDECAR_RE.test(resolved)) continue;
      const entry = byPath.get(resolved);
      if (!entry || (entry.size ?? 0) > MAX_JSON_BYTES) continue;
      try {
        const json = await reader.text(resolved);
        JSON.parse(json); // validate; JSON is a subset of a JS expression
        content = content.replace(statement, `const ${local} = ${json};`);
      } catch {
        // leave the import in place; the extractor will report what it can't resolve
      }
    }

    // Glob imports are resolved once the asset pass has URLs for the matches.
    for (const m of content.matchAll(GLOB_RE)) {
      const patterns = m[1].startsWith("[")
        ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1])
        : [m[1].slice(1, -1)];
      const matches = [...new Set(patterns.flatMap((pat) => expandGlob(pat, current, paths)))];
      for (const repoPath of matches) {
        const ext = path.posix.extname(repoPath).toLowerCase();
        if ((SIDECAR_RE.test(repoPath) || MEDIA_EXT_TO_TYPE[ext]) && !assetRequests.has(`glob:${repoPath}`)) {
          assetRequests.set(`glob:${repoPath}`, { spec: `glob:${repoPath}`, resolved: repoPath });
        }
      }
      globRequests.push({ file: current, text: m[0], patterns, options: m[2] ?? "", matches });
    }

    sources.set(current, content);
  }

  // Media is fetched after the crawl, several files at a time: a faculty page
  // can reference two hundred portraits, and one request at a time would make
  // a sync take minutes.
  const assets = new AssetCollector(reader);
  await runPool(ASSET_CONCURRENCY, [...assetRequests.values()], async (req) => {
    const entry = byPath.get(req.resolved);
    if (!entry) return;
    const url = SIDECAR_RE.test(req.resolved)
      ? await assets.fromSidecar(entry)
      : await assets.fromRepoFile(entry, path.posix.extname(req.resolved).toLowerCase());
    if (url) assets.urls.set(req.spec, url);
  });

  // Replace each import.meta.glob(...) with the object Vite would have built.
  for (const req of globRequests) {
    const asDefault = /import\s*:\s*["']default["']/.test(req.options);
    const entries: string[] = [];
    for (const repoPath of req.matches) {
      const key = globKey(req.patterns.find((pat) => expandGlob(pat, req.file, [repoPath]).length > 0) ?? req.patterns[0], repoPath, req.file);
      let value: string | undefined;
      if (SIDECAR_RE.test(repoPath)) {
        const url = assets.urls.get(`glob:${repoPath}`);
        if (url) value = JSON.stringify({ url });
      } else if (MEDIA_EXT_TO_TYPE[path.posix.extname(repoPath).toLowerCase()]) {
        const url = assets.urls.get(`glob:${repoPath}`);
        if (url) value = JSON.stringify(url);
      } else if (/\.json$/i.test(repoPath) && (byPath.get(repoPath)?.size ?? 0) <= MAX_JSON_BYTES) {
        try {
          const json = await reader.text(repoPath);
          JSON.parse(json);
          value = json;
        } catch { /* skipped */ }
      }
      if (value === undefined) continue;
      entries.push(`${JSON.stringify(key)}: ${asDefault ? value : `{ default: ${value} }`}`);
    }
    const literal = `({ ${entries.join(", ")} })`;
    const content = sources.get(req.file);
    if (content) sources.set(req.file, content.split(req.text).join(literal));
  }

  // Theme CSS: Lovable keeps design tokens in src/index.css (Vite template)
  // or src/styles.css (TanStack Start template, Tailwind v4 @theme blocks).
  let themeCss: string | undefined;
  for (const cssPath of ["src/index.css", "src/styles.css", "src/App.css", "src/styles/globals.css"]) {
    if (paths.has(cssPath)) {
      themeCss = await reader.text(cssPath);
      break;
    }
  }

  // Self-hosted public/ assets referenced by absolute paths — fonts in
  // @font-face ("/fonts/x.ttf") and images used as src="/lovable-uploads/y.png".
  // Fetch them from the repo's public/ dir and rewrite to our storage.
  const PUBLIC_REF_RE = /["'(](\/[\w\-./]+\.(png|jpe?g|webp|gif|svg|avif|mp4|webm|ttf|otf|woff2?))["')]/gi;
  const publicRefs = new Map<string, TreeEntry>();
  for (const content of [...sources.values(), themeCss ?? ""]) {
    for (const m of content.matchAll(PUBLIC_REF_RE)) {
      const urlPath = m[1];
      const entry = byPath.get("public" + urlPath);
      if (entry && !publicRefs.has(urlPath)) publicRefs.set(urlPath, entry);
    }
  }
  const publicUrlMap = new Map<string, string>();
  await runPool(ASSET_CONCURRENCY, [...publicRefs.entries()], async ([urlPath, entry]) => {
    const url = await assets.fromRepoFile(entry, path.posix.extname(urlPath).toLowerCase());
    if (url) publicUrlMap.set(urlPath, url);
  });
  for (const [p, url] of publicUrlMap) assets.urls.set(p, url);
  if (themeCss) {
    for (const [p, url] of publicUrlMap) themeCss = themeCss.split(p).join(url);
  }
  // `bg-[url('/pattern.svg')]` and `src="/lovable-uploads/x.png"` live in the
  // components themselves; those paths have no file behind them on this host.
  if (publicUrlMap.size > 0) {
    for (const [file, content] of sources) {
      let next = content;
      for (const [p, url] of publicUrlMap) next = next.split(`"${p}"`).join(`"${url}"`).split(`'${p}'`).join(`'${url}'`).split(`(${p})`).join(`(${url})`);
      if (next !== content) sources.set(file, next);
    }
  }

  // Custom design tokens (colors, gradients, shadows, animations) live in
  // tailwind.config — Tailwind v4 projects have none and use @theme in CSS.
  let tailwindConfig: string | undefined;
  for (const cfgPath of ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs"]) {
    if (paths.has(cfgPath)) {
      tailwindConfig = await reader.text(cfgPath);
      break;
    }
  }
  // Google Fonts links live in index.html (Vite template). TanStack Start has
  // no index.html — the same <link> tags are declared as head objects on the
  // root route, and googleFontImports() reads either shape.
  let indexHtml: string | undefined;
  for (const headPath of ["index.html", "src/routes/__root.tsx"]) {
    if (paths.has(headPath)) {
      indexHtml = await reader.text(headPath);
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
    assetUrls: assets.urls,
    filesBundled: [...sources.keys()],
    assetsUploaded: assets.uploaded,
    assetsRemote: assets.remote,
    truncated: queue.length > 0,
  };
}

/** Run `work` over `items` with at most `limit` in flight; failures never abort the batch. */
async function runPool<T>(limit: number, items: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await work(item);
      } catch {
        // Best effort: an asset that fails to fetch becomes a placeholder.
      }
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Lovable asset sidecars
// ---------------------------------------------------------------------------

export type LovableSidecar = {
  /** Absolute URL of the hosted file. */
  url: string;
  assetId: string | null;
  filename: string;
  contentType: string | null;
  size: number | null;
};

/**
 * Parse a `*.asset.json` sidecar. Its `url` is a path on the project's own
 * Lovable host (`/__l5e/assets-v1/<id>/<name>`), which is reachable at
 * `https://<project_id>.lovableproject.com` — the stable per-project origin
 * that exists whether or not the project is published.
 */
export function parseLovableSidecar(json: string, fallbackName: string): LovableSidecar | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!data || typeof data.url !== "string" || !data.url) return null;
  const rawUrl = data.url.trim();
  let url: string;
  if (/^https?:\/\//i.test(rawUrl)) url = rawUrl;
  else if (rawUrl.startsWith("/") && typeof data.project_id === "string" && /^[\w-]+$/.test(data.project_id)) {
    url = `https://${data.project_id}.lovableproject.com${rawUrl}`;
  } else return null;

  const filename =
    (typeof data.original_filename === "string" && data.original_filename) ||
    path.posix.basename(new URL(url).pathname) ||
    fallbackName;
  return {
    url,
    assetId: typeof data.asset_id === "string" ? data.asset_id : null,
    filename,
    contentType: typeof data.content_type === "string" ? data.content_type : null,
    size: typeof data.size === "number" ? data.size : null,
  };
}

/**
 * Fetches media into our storage and records it in the media library. Each
 * imported file carries a `sourceRef`, so a later sync of the same page finds
 * the stored copy instead of downloading everything again.
 */
class AssetCollector {
  urls = new Map<string, string>();
  uploaded: string[] = [];
  remote: string[] = [];

  constructor(private reader: RepoReader) {}

  async fromSidecar(entry: TreeEntry): Promise<string | null> {
    const json = await this.reader.text(entry.path);
    const sidecar = parseLovableSidecar(json, path.posix.basename(entry.path).replace(SIDECAR_RE, ""));
    if (!sidecar) return null;

    const contentType = sidecar.contentType ?? MEDIA_EXT_TO_TYPE[path.posix.extname(sidecar.filename).toLowerCase()];
    const limit = contentType && ALLOWED_VIDEO_TYPES[contentType] ? MAX_VIDEO_BYTES : MAX_ASSET_BYTES;
    const storable = contentType && (ALLOWED_IMAGE_TYPES[contentType] || ALLOWED_VIDEO_TYPES[contentType]);
    if (!storable || (sidecar.size !== null && sidecar.size > limit)) {
      // Too big or not a type we store: the page keeps loading it from Lovable.
      this.remote.push(entry.path);
      return sidecar.url;
    }

    const sourceRef = sidecar.assetId ? `lovable:${sidecar.assetId}` : `lovable-url:${sidecar.url}`;
    const stored = await this.store(sourceRef, contentType, sidecar.filename, () => fetchRemote(sidecar.url, limit));
    if (stored) {
      this.uploaded.push(entry.path);
      return stored;
    }
    this.remote.push(entry.path);
    return sidecar.url;
  }

  async fromRepoFile(entry: TreeEntry, ext: string): Promise<string | null> {
    const contentType = MEDIA_EXT_TO_TYPE[ext] ?? FONT_EXT_TO_TYPE[ext];
    if (!contentType) return null;
    const limit = ALLOWED_VIDEO_TYPES[contentType] ? MAX_VIDEO_BYTES : MAX_ASSET_BYTES;
    if ((entry.size ?? 0) > limit) return null;
    const stored = await this.store(`sha:${entry.sha}`, contentType, path.posix.basename(entry.path), () =>
      this.reader.bytes(entry),
    );
    if (stored) this.uploaded.push(entry.path);
    return stored;
  }

  private store(
    sourceRef: string,
    contentType: string,
    filename: string,
    fetchBytes: () => Promise<Buffer | null>,
  ): Promise<string | null> {
    // A project sync imports several pages at once and they share assets (the
    // nav logo, the footer). One download per asset, however many ask for it.
    const pending = inflightStores.get(sourceRef);
    if (pending) return pending;
    const work = this.storeOnce(sourceRef, contentType, filename, fetchBytes).finally(() => {
      inflightStores.delete(sourceRef);
    });
    inflightStores.set(sourceRef, work);
    return work;
  }

  private async storeOnce(
    sourceRef: string,
    contentType: string,
    filename: string,
    fetchBytes: () => Promise<Buffer | null>,
  ): Promise<string | null> {
    const known = await db.mediaAsset.findFirst({ where: { sourceRef }, select: { url: true } });
    if (known && (await storage.read(known.url))) return known.url;

    try {
      const buffer = await fetchBytes();
      if (!buffer) return null;
      const stored = await storage.put(buffer, filename, contentType);

      let width: number | null = null;
      let height: number | null = null;
      if (ALLOWED_IMAGE_TYPES[contentType]) {
        try {
          const { imageSize } = await import("image-size");
          const dim = imageSize(buffer);
          width = dim.width ?? null;
          height = dim.height ?? null;
        } catch { /* dimensions best-effort */ }
      }

      // Identical bytes under two source refs land on the same content-hashed
      // URL; losing that upsert race is not a failure — the file is stored.
      await db.mediaAsset
        .upsert({
          where: { url: stored.url },
          create: { url: stored.url, filename: stored.filename, width, height, size: stored.size, sourceRef },
          update: { sourceRef },
        })
        .catch(() => undefined);
      return stored.url;
    } catch {
      return null;
    }
  }
}

const globalForStores = globalThis as unknown as { inflightAssetStores?: Map<string, Promise<string | null>> };
const inflightStores =
  globalForStores.inflightAssetStores ?? (globalForStores.inflightAssetStores = new Map<string, Promise<string | null>>());

const FONT_EXT_TO_TYPE: Record<string, string> = {
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Download a hosted asset, giving up on slow hosts and oversized bodies. */
async function fetchRemote(url: string, limit: number): Promise<Buffer | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    headers: { "User-Agent": "LovableEditor" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > limit) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer.length > limit ? null : buffer;
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
