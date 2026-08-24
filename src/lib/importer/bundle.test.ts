import { test } from "node:test";
import assert from "node:assert/strict";
import { findPageFiles, suggestRoute } from "./bundle";
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
