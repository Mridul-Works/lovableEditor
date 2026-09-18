# LovableEditor

Internal tool that turns pages exported from [Lovable](https://lovable.dev) into live,
CMS-editable pages served on our own domain. After a page is imported once, non-technical
admins can edit every text and image from an admin panel — changes are live instantly,
with no rebuilds or redeploys.

## How it works

**Connected mode (recommended):** Lovable syncs every project to GitHub (free plan
included). Connect that GitHub account once under **Admin → Lovable projects** (read-only
fine-grained token, or `GITHUB_TOKEN` in `.env`). You then browse all your projects, open
one, and import any of its pages with one click — the app pulls the page file, follows its
imports to bundle every section component, applies the project's `index.css` theme, and
uploads the repo's image assets into the media library. After design changes in Lovable,
hit **Sync** on the page (pages list or project view) — content edits survive.

**Dashboard.** `/admin` is a dashboard backed by TanStack Query: totals (pages, published,
drafts, pages behind GitHub, placeholder images, fields, media), one card per connected
Lovable project with GitHub's current head commit, push time, last sync and buttons to
import missing or sync outdated pages, and the page list with source, sync state, import
quality, filters and search. It refreshes every five minutes and on **Check GitHub now**;
GitHub is asked at most once a minute per project.

**Look and feel.** The admin UI takes its theme from mastersunion.org: ink `#090909` and the
neutral grey ramp, sun yellow `#FAD133` as accent, leaf green for positive states, ember
orange for warnings, pill-shaped controls, and one signature — page titles end in a light
italic Fraunces word underlined by the brand's blue-yellow-orange squiggle. Tokens live in
`src/app/globals.css`; Outfit (standing in for the site's licensed geometric sans) and
Fraunces load at runtime through `BrandFonts`, on admin surfaces only, so imported pages
keep their own typography and the build needs no network.

**Syncing a whole project.** A Lovable project is a site, not a page. The project screen
(**Admin → Lovable projects → a repo**) shows how many of its page files are imported and
which are behind the latest push, and **Sync entire project** imports the missing pages
and re-syncs the rest, three at a time, at each file's own route (`src/routes/a.b.tsx` →
`/a/b`). New pages can be published as they land; existing pages keep their status and
their edits. A route already used by a different source is reported, never overwritten.
The repo is read from one branch tarball per commit (`src/lib/importer/snapshot.ts`)
instead of hundreds of per-file API calls, so a 38-page project syncs in about a minute.

Lovable projects reference media two ways and both are imported: image files committed
to the repo (`import hero from "@/assets/hero.webp"`) and, in newer projects, JSON
sidecars (`hero.webp.asset.json`) pointing at a file hosted by Lovable. Sidecar images
are downloaded into the media library; videos and oversized files keep their hosted URL.
Assets remember where they came from (`MediaAsset.sourceRef`), so a re-sync reuses the
stored copies instead of downloading everything again.

**Paste mode (fallback):**

1. **Import** (`/admin/import`) — paste the exported page component (TSX/JSX) and pick a
   route (e.g. `/pricing`). If the page is split into components, paste the page file plus
   each component file together in one paste. The code is parsed with Babel **as data — it is never
   executed**. The JSX becomes a JSON render tree; every visible string (including `alt`,
   `title`, `placeholder`, `aria-label`) and every image becomes an editable **field**
   with a stable key (`hero-h1-a3f2` = section + tag + content hash). Tailwind CSS for
   the page's classes is compiled at import time and stored with the page.
2. **Render** — a catch-all server component looks the route up in the DB and renders the
   tree, injecting each field's current value. Published pages are public; drafts 404
   publicly but render for admins with a Draft banner.
3. **Edit** — either in the field editor (`/admin/pages/[id]`: fields grouped by page
   section on the left, the live page on the right; typing updates the preview instantly
   and clicking anything on the page jumps to its field) or directly on the page
   (`/pricing?edit=1` as a logged-in admin: click text to edit in place, click an image
   to replace it, click a link or video to change its URL, hover a background image for
   a "Change background" button). Text, images, CSS backgrounds, link targets and video
   sources are all fields. Saves revalidate the route — live in seconds.
4. **Re-import** — paste an updated version of the page to the same route. Fields are
   matched by key: existing edits are kept, new content is added, removed content is
   flagged *orphaned* (kept in DB, not rendered).

What is stripped by design: state, event handlers, effects, `<script>`,
`dangerouslySetInnerHTML` — the import report says exactly what was removed. Unknown
components (shadcn/ui etc.) render as passthrough wrappers; lucide icons are baked in as
inline SVG from `lucide-static`, with alias spellings (`ImageIcon`, `LucideX`) and the brand
icons lucide retired in v1 (Instagram, Linkedin, Youtube, Twitter, Facebook, Github, …)
served from the pinned `lucide-static-legacy` alias package.

## Setup

```bash
npm install
cp .env.example .env        # then edit values
npx prisma migrate dev      # creates SQLite dev DB
npm run db:seed             # seeds the admin from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev
```

Log in at `/admin/login` with the seeded credentials.

### Environment

| Var | Purpose |
|---|---|
| `DATABASE_URL` | `file:./prisma/dev.db` for dev; a Postgres URL in production (also switch `provider` in `prisma/schema.prisma` to `postgresql` and re-generate — the schema uses no SQLite-only or Postgres-only features) |
| `AUTH_SECRET` | 16+ char secret signing the session cookie |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded admin account (`npm run db:seed`) |
| `STORAGE_DRIVER` | `local` (default). Add an S3-compatible driver in `src/lib/storage.ts` |
| `UPLOADS_DIR` | Where the local driver stores images (served via `/uploads/*`) |

## Scripts

- `npm run dev` / `build` / `start` — Next.js
- `npm run db:migrate` / `db:seed` / `db:studio` — Prisma
- `npx tsx scripts/e2e.ts` — full acceptance test (needs the app running on :4000 and Edge installed; `BASE=` overrides the URL)
- GitHub-integration test: `npx tsx scripts/mock-github.ts` (mock API on :4599), then the app with `GITHUB_API_BASE=http://127.0.0.1:4599`, then `BASE=... npx tsx scripts/e2e-github.ts`
- `NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-extract.ts [file]` — run the extractor against a fixture

## Architecture notes

- **Imported code is data.** No eval, no compilation of user-pasted code. The extractor
  (`src/lib/importer/extract.ts`) resolves *static data only*: literal arrays are
  expanded through `.map()`, `.filter()`, `.find()` and the "chunk into pages" `for`
  loop; `useState` initial values decide conditionals; component-body locals are scoped
  per component (import aliases such as `import { pgpHero as hero }` per file) so two
  components' `active` never collide; `useMemo`, `reduce`, `new Set(...).size`,
  `Object.entries`, optional chains and helper guard clauses are evaluated; scroll-driven decks (a
  `340vh` runway with a sticky child and stacked panels) are laid out as a plain
  sequence. Anything still dynamic is dropped and reported.
- **Data files and globs.** The GitHub bundler inlines `import data from "./x.json"`
  and expands `import.meta.glob("/src/assets/**/*.asset.json")` against the repo tree,
  uploading the matched Lovable-hosted images, so galleries driven by a JSON table
  render with their photos.
- **Per-page CSS.** Tailwind can't see class names stored in the DB at build time, so
  `src/lib/importer/tailwind.ts` compiles the page's class list with Tailwind's
  programmatic API at import time (with default shadcn tokens; paste the Lovable
  project's `index.css` in the import form for exact colors).
- **Instant publishing.** Public reads go through a tag-cached query
  (`src/lib/pages.ts`); every save/import/publish calls `updateTag` + `revalidatePath`.
- **Auth.** Credentials → bcrypt hash check → HS256 JWT session cookie; `src/proxy.ts`
  gates all `/admin` routes, and every server action re-checks the session
  (`requireAdmin`).
- **Editor state.** The admin editor (`src/components/admin/editor/`) keeps saved fields
  in TanStack Query (seeded from the server, refetched from `/api/admin/pages/[id]/fields`
  after each save) and unsaved drafts in local state; the field list is virtualized with
  TanStack Virtual, so thousand-field pages stay responsive. The live preview is the
  real page in an iframe (`?preview=1`); `src/components/PreviewBridge.tsx` applies
  edits over `postMessage` using the `data-cms-*` attributes the renderer emits.
- **Storage.** All media bytes go through `src/lib/storage.ts` (local driver included;
  S3-compatible drivers plug in behind the same interface). Files are served by
  `/uploads/[...file]` with immutable caching — content-hashed filenames.

## Known limits

- Interactive behavior in imported pages (state, handlers, animations) is stripped by
  design; the import report lists everything that was removed.
- In *paste* mode, image imports (`import hero from "@/assets/…"`) have no file to
  resolve to — they get a placeholder and a report note; GitHub imports resolve them.
  Images whose URL is computed by runtime-only code (a helper that searches a lookup
  table with `String.includes` and builds a `URLSearchParams` query, for example) fall
  back to a placeholder; upload the real image in the editor.
- `npm run build` needs no network access: the admin UI uses the platform font stack
  instead of a Google font fetched at build time.
- Field keys include the section name, so a Lovable redesign that moves content between
  sections re-keys those fields on the next sync: previous edits to them are kept as
  orphans in the editor rather than applied automatically.
- `next/image` is intentionally not used for imported content (arbitrary hosts + data
  URIs); images render as plain `<img>`.
