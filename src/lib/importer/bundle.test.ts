import { test } from "node:test";
import assert from "node:assert/strict";
import { expandGlob, findPageFiles, globKey, globToRegExp, parseLovableSidecar, suggestRoute } from "./bundle";
import type { TreeEntry } from "@/lib/github";

const blobs = (...paths: string[]): TreeEntry[] =>
  paths.map((path) => ({ path, type: "blob" as const, sha: "x" }));

// Lovable ships two project templates: the Vite/React Router one (src/pages)
// and the TanStack Start one (file-based src/routes). Both have to be found.

test("classic src/pages layout is detected, Index first", () => {
  const pages = findPageFiles(
    blobs("src/App.tsx", "src/pages/About.tsx", "src/pages/Index.tsx", "src/pages/NotFound.tsx"),
  );
  assert.deepEqual(pages, ["src/pages/Index.tsx", "src/pages/About.tsx"]);
});

test("src/App.tsx is the fallback when there are no pages and no routes", () => {
  assert.deepEqual(findPageFiles(blobs("src/App.tsx", "src/main.tsx")), ["src/App.tsx"]);
});

test("TanStack routes are detected with index first", () => {
  const pages = findPageFiles(
    blobs(
      "src/routes/__root.tsx",
      "src/routes/about.tsx",
      "src/routes/index.tsx",
      "src/routes/programmes.pg.pgp-tbm.tsx",
    ),
  );
  assert.equal(pages[0], "src/routes/index.tsx");
  assert.ok(pages.includes("src/routes/about.tsx"));
  assert.ok(!pages.includes("src/routes/__root.tsx"), "__root is not a page");
});

test("non-page route files are excluded", () => {
  const pages = findPageFiles(
    blobs(
      "src/routes/index.tsx",
      "src/routes/__root.tsx",          // root wrapper
      "src/routes/posts/route.tsx",     // pathless layout
      "src/routes/posts/$postId.tsx",   // dynamic, no single static route
      "src/routes/-components/Card.tsx", // "-" marks a non-route file
    ),
  );
  assert.deepEqual(pages, ["src/routes/index.tsx"]);
});

test("src/pages wins over src/routes when a project has both", () => {
  const pages = findPageFiles(blobs("src/pages/Index.tsx", "src/routes/index.tsx"));
  assert.deepEqual(pages, ["src/pages/Index.tsx"]);
});

test("suggestRoute maps classic page names", () => {
  assert.equal(suggestRoute("src/pages/Index.tsx"), "/");
  assert.equal(suggestRoute("src/pages/AboutUs.tsx"), "/about-us");
  assert.equal(suggestRoute("src/App.tsx"), "/");
});

test("suggestRoute understands TanStack dot- and directory-nesting", () => {
  assert.equal(suggestRoute("src/routes/index.tsx"), "/");
  assert.equal(suggestRoute("src/routes/about.tsx"), "/about");
  assert.equal(
    suggestRoute("src/routes/programmes.pg.pgp-tbm.tsx"),
    "/programmes/pg/pgp-tbm",
  );
  assert.equal(suggestRoute("src/routes/posts/index.tsx"), "/posts");
  // Pathless layout segments contribute no path of their own.
  assert.equal(suggestRoute("src/routes/_layout.settings.tsx"), "/settings");
});

// Newer Lovable projects keep binaries out of git and commit a JSON sidecar
// pointing at the hosted file instead.

test("a Lovable sidecar resolves to the project's asset host", () => {
  const side = parseLovableSidecar(JSON.stringify({
    version: 1,
    asset_id: "1e051b66-328e-4610-8744-34733b8649f2",
    project_id: "79e3b574-96e7-4811-a43f-99492a9fe2c6",
    url: "/__l5e/assets-v1/1e051b66-328e-4610-8744-34733b8649f2/ManojKohli.webp",
    original_filename: "ManojKohli.webp",
    size: 36946,
    content_type: "image/webp",
  }), "fallback.webp");
  assert.ok(side);
  assert.equal(
    side.url,
    "https://79e3b574-96e7-4811-a43f-99492a9fe2c6.lovableproject.com/__l5e/assets-v1/1e051b66-328e-4610-8744-34733b8649f2/ManojKohli.webp",
  );
  assert.equal(side.assetId, "1e051b66-328e-4610-8744-34733b8649f2");
  assert.equal(side.contentType, "image/webp");
  assert.equal(side.filename, "ManojKohli.webp");
});

test("a sidecar with an absolute URL is taken as-is; garbage is rejected", () => {
  const abs = parseLovableSidecar(JSON.stringify({ url: "https://cdn.example.com/a/b.png" }), "x.png");
  assert.equal(abs?.url, "https://cdn.example.com/a/b.png");
  assert.equal(abs?.filename, "b.png");
  assert.equal(parseLovableSidecar("not json", "x.png"), null);
  assert.equal(parseLovableSidecar(JSON.stringify({ url: "/relative/no/project" }), "x.png"), null);
  assert.equal(parseLovableSidecar(JSON.stringify({ url: "/x", project_id: "evil.host/../" }), "x.png"), null);
});

// import.meta.glob — Vite resolves it at build time; the bundler has to do
// the same against the repo tree so galleries keyed by file path resolve.

test("globs expand against the repo tree and key the way Vite does", () => {
  const paths = [
    "src/assets/meet-masters/a.png.asset.json",
    "src/assets/meet-masters/b.webp.asset.json",
    "src/assets/other/c.png.asset.json",
    "src/components/x.tsx",
  ];
  assert.deepEqual(expandGlob("/src/assets/meet-masters/*.asset.json", "src/lib/meet.ts", paths), [
    "src/assets/meet-masters/a.png.asset.json",
    "src/assets/meet-masters/b.webp.asset.json",
  ]);
  assert.deepEqual(expandGlob("../assets/**/*.asset.json", "src/lib/meet.ts", paths), [
    "src/assets/meet-masters/a.png.asset.json",
    "src/assets/meet-masters/b.webp.asset.json",
    "src/assets/other/c.png.asset.json",
  ]);
  assert.equal(globKey("/src/assets/meet-masters/*.asset.json", "src/assets/meet-masters/a.png.asset.json", "src/lib/meet.ts"), "/src/assets/meet-masters/a.png.asset.json");
  assert.equal(globKey("../assets/**/*.asset.json", "src/assets/other/c.png.asset.json", "src/lib/meet.ts"), "../assets/other/c.png.asset.json");
  assert.ok(globToRegExp("src/a/*.png").test("src/a/x.png"));
  assert.ok(!globToRegExp("src/a/*.png").test("src/a/b/x.png"));
  assert.ok(globToRegExp("src/**/*.png").test("src/a/b/x.png"));
});
