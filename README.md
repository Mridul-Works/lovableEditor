# LovableEditor

Internal tool that turns pages exported from [Lovable](https://lovable.dev) into live,
CMS-editable pages served on our own domain. After a page is imported once, non-technical
admins can edit every text and image from an admin panel — changes are live instantly,
with no rebuilds or redeploys.

## How it works

1. **Import** (`/admin/import`) — paste the exported page component (TSX/JSX) and pick a
   route (e.g. `/pricing`). The code is parsed with Babel **as data — it is never
   executed**. The JSX becomes a JSON render tree; every visible string (including `alt`,
   `title`, `placeholder`, `aria-label`) and every image becomes an editable **field**
   with a stable key (`hero-h1-a3f2` = section + tag + content hash). Tailwind CSS for
   the page's classes is compiled at import time and stored with the page.
2. **Render** — a catch-all server component looks the route up in the DB and renders the
   tree, injecting each field's current value. Published pages are public; drafts 404
   publicly but render for admins with a Draft banner.
3. **Edit** — either in the field editor (`/admin/pages/[id]`, grouped by page section)
   or directly on the page (`/pricing?edit=1` as a logged-in admin: click text to edit in
   place, click an image to replace it). Saves revalidate the route — live in seconds.
4. **Re-import** — paste an updated version of the page to the same route. Fields are
   matched by key: existing edits are kept, new content is added, removed content is
   flagged *orphaned* (kept in DB, not rendered).

What is stripped by design: state, event handlers, effects, `<script>`,
`dangerouslySetInnerHTML` — the import report says exactly what was removed. Unknown
components (shadcn/ui etc.) render as passthrough wrappers; lucide icons are baked in as
inline SVG from `lucide-static`.

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
- `npx tsx scripts/e2e.ts` — full acceptance test (needs the app running on :3000 and Edge installed)
- `NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-extract.ts [file]` — run the extractor against a fixture

## Architecture notes

- **Imported code is data.** No eval, no compilation of user-pasted code. The extractor
  (`src/lib/importer/extract.ts`) resolves *static data only*: literal arrays are
  expanded through `.map()`, `useState` initial values decide static conditionals, and
  anything dynamic is dropped and reported.
- **Per-page CSS.** Tailwind can't see class names stored in the DB at build time, so
  `src/lib/importer/tailwind.ts` compiles the page's class list with Tailwind's
  programmatic API at import time (with default shadcn tokens; paste the Lovable
  project's `index.css` in the import form for exact colors).
- **Instant publishing.** Public reads go through a tag-cached query
  (`src/lib/pages.ts`); every save/import/publish calls `updateTag` + `revalidatePath`.
- **Auth.** Credentials → bcrypt hash check → HS256 JWT session cookie; `src/proxy.ts`
  gates all `/admin` routes, and every server action re-checks the session
  (`requireAdmin`).
- **Storage.** All image bytes go through `src/lib/storage.ts` (local driver included;
  S3-compatible drivers plug in behind the same interface). Files are served by
  `/uploads/[...file]` with immutable caching — content-hashed filenames.

## Known limits

- Interactive behavior in imported pages (state, handlers, animations) is stripped by
  design; the import report lists everything that was removed.
- Image files imported from the Lovable project (`import hero from "@/assets/…"`) can't
  be resolved from pasted code — they get a placeholder and a report note; upload the
  real image in the editor.
- `next/image` is intentionally not used for imported content (arbitrary hosts + data
  URIs); images render as plain `<img>`.
