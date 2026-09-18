import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPage, normalizeRoute } from "./extract";
import type { ElementNode, ExtractedField, TreeNode } from "@/lib/tree";

// The extractor turns imported JSX into a render tree with no code left in it.
// Every case here is a page that rendered blank, unstyled, or with missing
// images before the fix it covers.

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

type Extracted = Awaited<ReturnType<typeof extractPage>>;

function textOf(nodes: TreeNode[], fields: ExtractedField[]): string {
  const byKey = new Map(fields.map((f) => [f.key, f.defaultValue]));
  const walk = (n: TreeNode): string =>
    n.t === "x" ? n.v : n.t === "f" ? (byKey.get(n.k) ?? "") : n.children.map(walk).join(" ");
  return nodes.map(walk).join(" ").replace(/\s+/g, " ").trim();
}

function elements(nodes: TreeNode[]): ElementNode[] {
  const out: ElementNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.t !== "e") continue;
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

const text = (r: Extracted) => textOf(r.tree, r.fields);
const tags = (r: Extracted, tag: string) => elements(r.tree).filter((e) => e.tag === tag);

// --------------------------------------------------------------------------
// routes
// --------------------------------------------------------------------------

test("normalizeRoute lowercases, collapses slashes and reserves app paths", () => {
  assert.equal(normalizeRoute("About-Us"), "/about-us");
  assert.equal(normalizeRoute("//a//b/"), "/a/b");
  assert.equal(normalizeRoute("/"), "/");
  for (const reserved of ["/admin", "/uploads/x", "/api/y", "/_next/z"]) {
    assert.throws(() => normalizeRoute(reserved), /reserved/i, reserved);
  }
  assert.throws(() => normalizeRoute("/Bad Route!"), /lowercase/i);
});

// --------------------------------------------------------------------------
// entry point resolution
// --------------------------------------------------------------------------

test("a TanStack route file's component is used, not a bundled default export", async () => {
  // Bundles concatenate the page LAST, so a component file's `export default`
  // must not outrank the route's own component.
  const result = await extractPage(`
    export default function BottomNav() { return <nav>nav chrome</nav>; }

    import { createFileRoute } from "@tanstack/react-router";
    function AboutPage() { return <main><h1>The real page</h1></main>; }
    export const Route = createFileRoute("/about")({ component: AboutPage });
  `);
  assert.match(text(result), /The real page/);
  assert.equal(result.tree[0].t === "e" && result.tree[0].tag, "main");
});

test("a classic default-exported page component still works", async () => {
  const result = await extractPage(`
    export default function Index() { return <main><h1>Classic Lovable</h1></main>; }
  `);
  assert.match(text(result), /Classic Lovable/);
});

// --------------------------------------------------------------------------
// props and children
// --------------------------------------------------------------------------

test("component props are bound so a mapped list renders", async () => {
  const result = await extractPage(`
    const NAV = [{ id: "a", label: "About" }, { id: "b", label: "Careers" }];
    function Nav({ items }) {
      return <ul>{items.map(({ id, label }) => <li key={id}>{label}</li>)}</ul>;
    }
    export default function Page() { return <main><Nav items={NAV} /></main>; }
  `);
  const rendered = text(result);
  assert.match(rendered, /About/);
  assert.match(rendered, /Careers/);
  assert.equal(tags(result, "li").length, 2);
});

test("children passed to a wrapper are rendered, not dropped", async () => {
  const result = await extractPage(`
    function Section({ children }) { return <section className="wrap">{children}</section>; }
    export default function Page() {
      return <main><Section><p>Inner copy</p></Section></main>;
    }
  `);
  assert.match(text(result), /Inner copy/);
});

test("children survive a wrapper that lays them out at runtime", async () => {
  // React.Children.toArray(...).map(...) cannot be expanded statically; the
  // children must be re-attached rather than lost with it.
  const result = await extractPage(`
    import * as React from "react";
    function Stack({ children }) {
      const panels = React.Children.toArray(children);
      return <div className="stack">{panels.map((c, i) => <div key={i}>{c}</div>)}</div>;
    }
    export default function Page() {
      return <main><Stack><h2>Panel one</h2><h2>Panel two</h2></Stack></main>;
    }
  `);
  const rendered = text(result);
  assert.match(rendered, /Panel one/);
  assert.match(rendered, /Panel two/);
});

test("spread props reach the element they are forwarded onto", async () => {
  // <img {...rest} /> loses src and className entirely if spreads are dropped.
  const result = await extractPage(`
    function Img(props) {
      const { onPointerDown, ...rest } = props;
      return <img {...rest} />;
    }
    export default function Page() {
      return <main><Img src="/photo.png" alt="A photo" className="rounded" /></main>;
    }
  `);
  const [img] = tags(result, "img");
  assert.ok(img, "expected an <img> in the tree");
  assert.ok("src" in img.props, "img lost its src");
  assert.equal(img.props.className, "rounded");
});

// --------------------------------------------------------------------------
// expression resolution
// --------------------------------------------------------------------------

test("className built by concatenating a literal with a conditional is kept", async () => {
  // `"base " + (flag ? a : b)` used to drop the whole class string, leaving the
  // element completely unstyled.
  const result = await extractPage(`
    import { useState } from "react";
    export default function Page() {
      const [scrolled] = useState(false);
      return (
        <main className={"flex items-center rounded-full " + (scrolled ? "shadow-xl" : "shadow-md")}>
          <span>content</span>
        </main>
      );
    }
  `);
  const main = result.tree[0] as ElementNode;
  assert.match(String(main.props.className), /flex items-center rounded-full/);
  assert.match(String(main.props.className), /shadow-md/);
});

test("a computed index resolves through useState's initial value", async () => {
  const result = await extractPage(`
    import { useState } from "react";
    const CHAPTERS = [{ title: "Chapter one" }, { title: "Chapter two" }];
    export default function Page() {
      const [index] = useState(0);
      const chapter = CHAPTERS[index];
      return <main><h1>{chapter.title}</h1></main>;
    }
  `);
  assert.match(text(result), /Chapter one/);
});

test("derived lookup tables resolve through helper calls and spreads", async () => {
  const result = await extractPage(`
    const EXTRA = { "/campus": { blurb: "Campus blurb" } };
    function withExtra(c) { const e = EXTRA[c.route]; return { ...c, ...e }; }
    const RAW = [{ route: "/campus", tag: "Campus" }];
    const ALL = RAW.map((c) => withExtra(c));
    const BY_ROUTE = Object.fromEntries(ALL.map((c) => [c.route, c]));
    const chapter = BY_ROUTE["/campus"];
    export default function Page() {
      return <main><h1>{chapter.tag}</h1><p>{chapter.blurb}</p></main>;
    }
  `);
  const rendered = text(result);
  assert.match(rendered, /Campus/);
  assert.match(rendered, /Campus blurb/);
});

test("array methods and spreads keep a list expandable", async () => {
  const result = await extractPage(`
    const REST = [{ n: "Second" }, { n: "Third" }];
    const ALL = [{ n: "First" }, ...REST];
    export default function Page() {
      return <ul>{ALL.slice(0, 3).map((x, i) => <li key={i}>{x.n}</li>)}</ul>;
    }
  `);
  assert.equal(tags(result, "li").length, 3);
  assert.match(text(result), /First .*Second .*Third/);
});

test("string builtins used for counters are evaluated", async () => {
  const result = await extractPage(`
    import { useState } from "react";
    const ITEMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    export default function Page() {
      const [index] = useState(0);
      return <main><span>{String(index + 1).padStart(2, "0")}</span><span>{String(ITEMS.length).padStart(2, "0")}</span></main>;
    }
  `);
  assert.match(text(result), /01/);
  assert.match(text(result), /10/);
});

// --------------------------------------------------------------------------
// visibility
// --------------------------------------------------------------------------

test("a panel group hidden entirely by inline style reveals its first panel", async () => {
  const result = await extractPage(`
    const GROUPS = [{ t: "Group A" }, { t: "Group B" }];
    export default function Page() {
      return (
        <div className="deck">
          {GROUPS.map((g) => (
            <div key={g.t} className="absolute inset-0" style={{ opacity: 0, visibility: "hidden" }}>
              <h3>{g.t}</h3>
            </div>
          ))}
        </div>
      );
    }
  `);
  const panels = elements(result.tree).filter(
    (e) => typeof e.props.className === "string" && e.props.className.includes("absolute inset-0"),
  );
  assert.equal(panels.length, 2);
  const visible = panels.filter((p) => {
    const style = p.props.style as Record<string, unknown> | undefined;
    return !style || (style.opacity !== 0 && style.visibility !== "hidden");
  });
  assert.equal(visible.length, 1, "exactly one panel should be revealed");
});

test("a deck already showing a panel is left alone", async () => {
  const result = await extractPage(`
    const SLIDES = [{ t: "One" }, { t: "Two" }];
    export default function Page() {
      return (
        <div className="deck">
          {SLIDES.map((s, i) => (
            <div key={s.t} className="absolute inset-0" style={{ opacity: i === 0 ? 1 : 0 }}>
              <h3>{s.t}</h3>
            </div>
          ))}
        </div>
      );
    }
  `);
  const hidden = elements(result.tree).filter((e) => {
    const style = e.props.style as Record<string, unknown> | undefined;
    return style?.opacity === 0;
  });
  assert.equal(hidden.length, 1, "the second slide should stay hidden");
});

test("a non-positioned element hidden by a runtime flag is revealed", async () => {
  const result = await extractPage(`
    import { useState } from "react";
    export default function Page() {
      const [navVisible] = useState(false);
      return (
        <main>
          <div className={\`transition-all \${navVisible ? "opacity-100" : "opacity-0 pointer-events-none"}\`}>
            <a href="/about">About</a>
          </div>
        </main>
      );
    }
  `);
  const wrapper = elements(result.tree).find(
    (e) => typeof e.props.className === "string" && e.props.className.includes("transition-all"),
  );
  assert.ok(wrapper);
  assert.doesNotMatch(String(wrapper.props.className), /opacity-0/);
});

// --------------------------------------------------------------------------
// safety
// --------------------------------------------------------------------------

test("event handlers and script tags never reach the tree", async () => {
  const result = await extractPage(`
    export default function Page() {
      return (
        <main>
          <button onClick={() => alert(1)}>Click</button>
          <script src="/evil.js" />
        </main>
      );
    }
  `);
  assert.equal(tags(result, "script").length, 0);
  const [button] = tags(result, "button");
  assert.ok(button);
  assert.ok(!Object.keys(button.props).some((k) => /^on[A-Z]/.test(k)));
  assert.ok(result.report.strippedHandlers.includes("onClick"));
});

// --------------------------------------------------------------------------
// assets, links and media become fields
// --------------------------------------------------------------------------

test("asset imports resolve through data arrays and object properties", async () => {
  const assetUrls = new Map([
    ["@/assets/location-mumbai.jpg", "/uploads/aa-mumbai.jpg"],
    ["@/assets/location-delhi.jpg", "/uploads/bb-delhi.jpg"],
  ]);
  const result = await extractPage(`
    import mumbai from "@/assets/location-mumbai.jpg";
    import delhi from "@/assets/location-delhi.jpg";
    const LOCATIONS = [{ name: "Mumbai", image: mumbai }, { name: "Delhi", image: delhi }];
    export default function Page() {
      return (
        <main>
          {LOCATIONS.map((l) => <img key={l.name} src={l.image} alt={l.name} />)}
        </main>
      );
    }
  `, { assetUrls });
  const srcs = result.fields.filter((f) => f.type === "IMAGE").map((f) => f.defaultValue);
  assert.deepEqual(srcs, ["/uploads/aa-mumbai.jpg", "/uploads/bb-delhi.jpg"]);
  assert.ok(!result.report.notes.some((n) => /placeholder/.test(n)), result.report.notes.join("\n"));
});

test("Lovable sidecar imports behave like { url } objects", async () => {
  const assetUrls = new Map([
    ["@/assets/logo-2.png.asset.json", "/uploads/cc-logo-2.png"],
    ["@/assets/campusFilm.mp4.asset.json", "https://p.lovableproject.com/__l5e/assets-v1/x/campusFilm.mp4"],
  ]);
  const result = await extractPage(`
    import logoAsset from "@/assets/logo-2.png.asset.json";
    import campusVideo from "@/assets/campusFilm.mp4.asset.json";
    const FACULTY = [{ name: "A", img: logoAsset.url }];
    export default function Page() {
      return (
        <main>
          <img src={logoAsset.url} alt="Logo" />
          {FACULTY.map((f) => <img key={f.name} src={f.img} alt={f.name} />)}
          <div style={{ backgroundImage: \`url(\${logoAsset.url})\` }} />
          <video src={campusVideo.url} playsInline />
        </main>
      );
    }
  `, { assetUrls });
  const images = result.fields.filter((f) => f.type === "IMAGE");
  assert.equal(images.length, 3);
  assert.ok(images.every((f) => f.defaultValue === "/uploads/cc-logo-2.png"), JSON.stringify(images));
  const [video] = result.fields.filter((f) => f.type === "VIDEO");
  assert.ok(video);
  assert.match(video.defaultValue, /campusFilm\.mp4$/);
  assert.equal(result.report.videoFields, 1);
  const [videoEl] = tags(result, "video");
  assert.deepEqual(videoEl.props.src, { $f: video.key });
});

test("an asset the bundler could not fetch keeps an editable placeholder slot", async () => {
  const result = await extractPage(`
    import hero from "@/assets/hero.webp";
    export default function Page() { return <main><img src={hero} alt="Hero" /></main>; }
  `);
  const [img] = result.fields.filter((f) => f.type === "IMAGE");
  assert.ok(img.defaultValue.startsWith("data:image/svg+xml"));
  assert.ok(result.report.notes.some((n) => /hero\.webp/.test(n)));
});

test("link targets become LINK fields and <source> follows its parent", async () => {
  const result = await extractPage(`
    export default function Page() {
      return (
        <main>
          <a href="https://example.com/brochure.pdf">Brochure</a>
          <Link to="/apply">Apply</Link>
          <picture><source srcSet="x" src="/a.webp" /><img src="/a.jpg" alt="" /></picture>
          <video><source src="/clip.mp4" type="video/mp4" /></video>
        </main>
      );
    }
  `);
  const links = result.fields.filter((f) => f.type === "LINK");
  assert.deepEqual(links.map((l) => l.defaultValue), ["https://example.com/brochure.pdf", "/apply"]);
  assert.equal(result.report.linkFields, 2);
  const anchors = tags(result, "a");
  assert.deepEqual(anchors[0].props.href, { $f: links[0].key });
  assert.deepEqual(anchors[1].props.href, { $f: links[1].key });
  const sources = tags(result, "source");
  const byKey = new Map(result.fields.map((f) => [f.key, f]));
  const typeOf = (node: ElementNode) => byKey.get((node.props.src as { $f: string }).$f)?.type;
  assert.equal(typeOf(sources[0]), "IMAGE");
  assert.equal(typeOf(sources[1]), "VIDEO");
});

test("?? and .find() resolve the way the runtime would", async () => {
  const result = await extractPage(`
    import { useState } from "react";
    const PATHWAYS = [
      { key: "school", headline: "Still in school", image: "/a.jpg" },
      { key: "work", headline: "Already working", image: "/b.jpg" },
    ];
    export default function Page() {
      const [activeKey] = useState("work");
      const active = PATHWAYS.find((p) => p.key === activeKey) ?? PATHWAYS[0];
      const fallback = undefinedThing || PATHWAYS.at(-1);
      return <main><h1>{active.headline}</h1><img src={active.image} alt="" /><p>{fallback.headline}</p></main>;
    }
  `);
  assert.match(text(result), /Already working/);
  const [img] = result.fields.filter((f) => f.type === "IMAGE");
  assert.equal(img.defaultValue, "/b.jpg");
  assert.equal(result.fields.filter((f) => f.section !== "meta" && f.defaultValue === "Already working").length, 2);
});

test("a wrapper component holding the sections names fields after its children", async () => {
  const result = await extractPage(`
    function StackReveal({ children }) { return <div className="stack">{children}</div>; }
    function Hero() { return <section><h1>Hero title</h1></section>; }
    function Stats() { return <section><p>Stats copy</p></section>; }
    function Gallery() { return <section><p>Gallery copy</p></section>; }
    export default function Page() {
      return (
        <main>
          <header><a href="/">Logo</a></header>
          <StackReveal><Hero /><Stats /><Gallery /></StackReveal>
        </main>
      );
    }
  `);
  const sectionOf = (value: string) =>
    result.fields.find((f) => f.section !== "meta" && f.defaultValue === value)?.section;
  assert.equal(sectionOf("Hero title"), "hero");
  assert.equal(sectionOf("Stats copy"), "stats");
  assert.equal(sectionOf("Gallery copy"), "gallery");
  assert.equal(sectionOf("Logo"), "header");
  // The wrapper still renders around its children.
  assert.equal(tags(result, "div").filter((d) => d.props.className === "stack").length, 1);
});

test("nested wrappers and childless section components are split into their sections", async () => {
  const result = await extractPage(`
    function TenThings() { return <section id="ten-things"><h2>Ten things</h2></section>; }
    function HomeSections() {
      return (
        <>
          <section className="pricing"><h2>Pricing</h2></section>
          <section className="faq"><h2>FAQ</h2></section>
          <footer><p>Footer text</p></footer>
        </>
      );
    }
    export default function Page() {
      return (
        <main>
          <div id="hero-curtain" className="relative">
            <section className="hero"><h1>Hero title</h1></section>
            <div className="relative z-10"><TenThings /><HomeSections /></div>
          </div>
        </main>
      );
    }
  `);
  const sectionOf = (value: string) =>
    result.fields.find((f) => f.section !== "meta" && f.defaultValue === value)?.section;
  assert.equal(sectionOf("Hero title"), "hero");
  assert.equal(sectionOf("Ten things"), "ten-things");
  assert.equal(sectionOf("Pricing"), "pricing");
  assert.equal(sectionOf("FAQ"), "faq");
  assert.equal(sectionOf("Footer text"), "footer");
});

// --------------------------------------------------------------------------
// component-local state and the idioms built on it
// --------------------------------------------------------------------------

test("each component's own state and locals win over another component's", async () => {
  const result = await extractPage(`
    import { useState } from "react";
    const VIDEOS = [{ thumb: "/v1.jpg", title: "One" }, { thumb: "/v2.jpg", title: "Two" }];
    function Nav() {
      const [active, setActive] = useState<string | null>(null);
      const current = "nav";
      return <nav>{current}</nav>;
    }
    function Videos() {
      const [active, setActive] = useState(0);
      const current = VIDEOS[active];
      return <section><img src={current.thumb} alt={current.title} /></section>;
    }
    export default function Page() { return <main><Nav /><Videos /></main>; }
  `);
  const [img] = result.fields.filter((f) => f.type === "IMAGE");
  assert.equal(img.defaultValue, "/v1.jpg");
  assert.match(text(result), /nav/);
});

test("Math.min, optional chaining and data-active on the selected group resolve", async () => {
  const result = await extractPage(`
    import { useState } from "react";
    const GROUPS = [{ label: "Industry", items: ["a"] }, { label: "Full-time", items: ["b"] }];
    export default function Page() {
      const [stage] = useState(0);
      const active = GROUPS[Math.min(stage, GROUPS.length - 1)];
      return (
        <main>
          {GROUPS.map((g) => (
            <div key={g.label} data-active={g.label === active?.label ? "true" : undefined}>{g.label}</div>
          ))}
        </main>
      );
    }
  `);
  const divs = tags(result, "div");
  assert.equal(divs[0].props["data-active"], "true");
  assert.equal(divs[1].props["data-active"], undefined);
});

test("a for-loop that chunks a list into pages is expanded", async () => {
  const result = await extractPage(`
    import { useState } from "react";
    const PEOPLE = [{ n: "A", cat: "x" }, { n: "B", cat: "y" }, { n: "C", cat: "x" }, { n: "D", cat: "y" }, { n: "E", cat: "x" }];
    function Pager({ items }) {
      const [page, setPage] = useState(0);
      const PER_PAGE = 2;
      const pages: typeof PEOPLE[] = [];
      for (let i = 0; i < items.length; i += PER_PAGE) pages.push(items.slice(i, i + PER_PAGE));
      return <div>{pages.map((p, pi) => <ul key={pi}>{p.map((x) => <li key={x.n}>{x.n}</li>)}</ul>)}</div>;
    }
    export default function Page() {
      const [active] = useState("x");
      const visible = active === "All" ? PEOPLE : PEOPLE.filter((p) => p.cat === active);
      return <main><Pager key={active} items={visible} /></main>;
    }
  `);
  // The filter runs statically (active is "x"), leaving A, C, E in pages of two.
  assert.equal(tags(result, "ul").length, 2);
  assert.equal(tags(result, "li").length, 3);
  assert.match(text(result), /A C E/);
});

test("a scroll deck with a runway and stacked panels is laid out as a sequence", async () => {
  const result = await extractPage(`
    export default function Page() {
      return (
        <main>
          <section id="journey" className="relative" style={{ height: "340vh" }}>
            <div className="sticky top-0 h-screen w-full overflow-hidden bg-neutral-100">
              <div className="absolute inset-0 flex items-center will-change-transform"><h2>Semester 01</h2></div>
              <div className="absolute inset-0 flex items-center will-change-transform"><h2>Semester 02</h2></div>
            </div>
          </section>
        </main>
      );
    }
  `);
  const [section] = tags(result, "section");
  assert.equal(section.props.style, undefined);
  const sticky = section.children[0] as ElementNode;
  assert.equal(sticky.props.className, "w-full bg-neutral-100");
  for (const panel of sticky.children as ElementNode[]) {
    assert.equal(panel.props.className, "flex items-center");
  }
  assert.ok(result.report.notes.some((n) => /scroll-driven deck/.test(n)));
});

test("a gallery built from a JSON table, a glob map and a helper resolves its photos", async () => {
  const result = await extractPage(`
    import { useState } from "react";
    const assetModules = ({ "/src/assets/mm/000-image.webp.asset.json": { "url": "/uploads/a.webp" } });
    function assetUrl(filename) {
      if (!filename) return "";
      return assetModules[\`/src/assets/mm/\${filename}.asset.json\`]?.url ?? "";
    }
    const CATEGORIES = ["Board", "Faculty"];
    const raw = { "Board": [{ name: "Ann", imageAsset: "000-image.webp" }], "Faculty": [{ name: "Bob", imageAsset: "missing.webp" }] };
    const masters = raw as Record<string, any>;
    export const TABLE = Object.fromEntries(
      CATEGORIES.map((c) => [c, masters[c].map((m) => ({ name: m.name, image: assetUrl(m.imageAsset) }))]),
    ) as Record<string, any>;
    function Section({ category }) {
      const [expanded] = useState(false);
      const cards = TABLE[category];
      return <section>{(expanded ? cards : cards.slice(0, 3)).map((m) => <img key={m.name} src={m.image} alt={m.name} />)}</section>;
    }
    export default function Page() { return <main>{CATEGORIES.map((c) => <Section key={c} category={c} />)}</main>; }
  `);
  const imgs = result.fields.filter((f) => f.type === "IMAGE").map((f) => f.defaultValue);
  assert.equal(imgs.length, 2);
  assert.equal(imgs[0], "/uploads/a.webp");
  assert.ok(imgs[1].startsWith("data:"), "an unmatched photo stays an editable placeholder");
});

test("missing properties are falsy, filters run statically, and body-local helpers are callable", async () => {
  const result = await extractPage(`
    import { useState } from "react";
    const PEOPLE = [{ n: "A", img: "/a.jpg", cat: "x" }, { n: "B", cat: "y" }, { n: "C", img: "/c.jpg", cat: "x" }];
    export default function Page() {
      const [active] = useState("x");
      const ytThumb = (id) => \`https://img.youtube.com/vi/\${id}/hqdefault.jpg\`;
      const withPhotos = PEOPLE.filter((p) => Boolean(p.img));
      const visible = withPhotos.filter((p) => p.cat === active);
      return (
        <main>
          {PEOPLE.map((p) => (p.img ? <img key={p.n} src={p.img} alt={p.n} /> : <span key={p.n} className="initials">{p.n}</span>))}
          <ul>{visible.map((p) => <li key={p.n}>{p.n}</li>)}</ul>
          <img src={ytThumb("abc")} alt="thumb" />
        </main>
      );
    }
  `);
  assert.equal(tags(result, "span").filter((s) => s.props.className === "initials").length, 1);
  assert.equal(tags(result, "li").length, 2);
  const imgs = result.fields.filter((f) => f.type === "IMAGE").map((f) => f.defaultValue);
  assert.deepEqual(imgs, ["/a.jpg", "/c.jpg", "https://img.youtube.com/vi/abc/hqdefault.jpg"]);
});

// --------------------------------------------------------------------------
// whole-project imports: aliases, memoised lists, aggregates, DOM hygiene
// --------------------------------------------------------------------------

test("import aliases resolve per file, even when two files reuse the alias", async () => {
  const result = await extractPage(`
// ===== src/lib/content.ts =====
export const pgpOutClass = { title: "OutClass title" };
export const pgpImmersions = { title: "Immersions title" };

// ===== src/components/PgOutClass.tsx =====
import { pgpOutClass as data } from "@/lib/content";
export function PgOutClass() { return <section><h2>{data.title}</h2></section>; }

// ===== src/components/PgImmersions.tsx =====
import { pgpImmersions as data } from "@/lib/content";
export function PgImmersions() { return <section><h2>{data.title}</h2></section>; }

// ===== src/routes/page.tsx (page) =====
import { PgOutClass } from "@/components/PgOutClass";
import { PgImmersions } from "@/components/PgImmersions";
export default function Page() { return <main><PgOutClass /><PgImmersions /></main>; }
  `);
  const headings = tags(result, "h2").map((h) => textOf([h], result.fields));
  assert.deepEqual(headings, ["OutClass title", "Immersions title"]);
});

test("a useMemo'd filtered list, reduce totals and Set sizes resolve", async () => {
  const result = await extractPage(`
    import { useMemo, useState } from "react";
    const PARTNERS = [
      { name: "IIT", country: "USA", pathways: [{ kind: "exchange", audiences: ["ug"] }, { kind: "transfer", audiences: ["all"] }] },
      { name: "Griffith", country: "Australia", pathways: [{ kind: "transfer", audiences: ["pg"] }] },
      { name: "IENYC", country: "USA", pathways: [] },
    ];
    function matches(p, audience) { return p.audiences.includes("all") || p.audiences.includes(audience); }
    export default function Page() {
      const [audience] = useState("any");
      const [kind] = useState("any");
      const filtered = useMemo(() => {
        return PARTNERS.map((partner) => ({
          partner,
          pathways: partner.pathways.filter((p) => {
            const audienceOk = audience === "any" ? true : matches(p, audience);
            const kindOk = kind === "any" || p.kind === kind;
            return audienceOk && kindOk;
          }),
        })).filter((row) => row.pathways.length > 0);
      }, [audience, kind]);
      const total = filtered.reduce((n, r) => n + r.pathways.length, 0);
      const countries = new Set(filtered.map((r) => r.partner.country));
      return (
        <main>
          <p className="total">{total}</p>
          <p className="countries">{countries.size}</p>
          <p className="all">{String(new Set(PARTNERS.map((p) => p.country)).size)}</p>
          {filtered.length === 0 ? <div className="empty">No match</div> : filtered.map((r) => <h3 key={r.partner.name}>{r.partner.name}</h3>)}
          <span className="joined">{["a", "", "b"].filter(Boolean).join(" · ")}</span>
        </main>
      );
    }
  `);
  const byClass = (cls: string) => textOf(elements(result.tree).filter((e) => e.props.className === cls), result.fields);
  assert.equal(byClass("total"), "3");
  assert.equal(byClass("countries"), "2");
  assert.equal(byClass("all"), "2");
  assert.equal(byClass("joined"), "a · b");
  assert.deepEqual(tags(result, "h3").map((h) => textOf([h], result.fields)), ["IIT", "Griffith"]);
  assert.equal(elements(result.tree).filter((e) => e.props.className === "empty").length, 0);
});

test("controlled inputs become uncontrolled and component-only props stay off the DOM", async () => {
  const result = await extractPage(`
    import { useState } from "react";
    export default function Page() {
      const [kind] = useState("any");
      return (
        <main>
          <select value={kind}><option value="any">Any</option></select>
          <input type="checkbox" checked={true} />
          <Accordion type="single" collapsible className="acc"><p>Body</p></Accordion>
          <Dialog><DialogContent><p>Modal body</p></DialogContent></Dialog>
        </main>
      );
    }
  `);
  const [select] = tags(result, "select");
  assert.equal(select.props.value, undefined);
  assert.equal(select.props.defaultValue, "any");
  const [input] = tags(result, "input");
  assert.equal(input.props.checked, undefined);
  assert.equal(input.props.defaultChecked, true);
  const acc = elements(result.tree).find((e) => e.props.className === "acc");
  assert.ok(acc);
  assert.deepEqual(Object.keys(acc.props), ["className"]);
  assert.doesNotMatch(text(result), /Modal body/);
});

test("a logo table built from a glob map with entries, split, pop and replace resolves", async () => {
  const result = await extractPage(`
    const logoModules = ({
      "../assets/recruiter-logos/McKinsey.png.asset.json": { default: { "url": "/uploads/mck.png" } },
      "../assets/recruiter-logos/Bain.png.asset.json": { default: { "url": "/uploads/bain.png" } },
    });
    const LOGOS: Record<string, string> = Object.fromEntries(
      Object.entries(logoModules).map(([path, mod]) => [
        path.split("/").pop()!.replace(".png.asset.json", ""),
        mod.default.url,
      ]),
    );
    function LogoRow({ names }: { names: string[] }) {
      const found = names.filter((n) => LOGOS[n]);
      if (found.length === 0) return null;
      return <div>{found.map((n) => <img key={n} src={LOGOS[n]} alt={n} />)}</div>;
    }
    export default function Page() {
      const video = "https://youtu.be/abc123?si=xyz";
      return (
        <main>
          <LogoRow names={["McKinsey", "Nobody", "Bain"]} />
          <img src={\`https://img.youtube.com/vi/\${(video as string).split("/").pop()?.split("?")[0]}/hqdefault.jpg\`} alt="thumb" />
        </main>
      );
    }
  `);
  const imgs = result.fields.filter((f) => f.type === "IMAGE").map((f) => f.defaultValue);
  assert.deepEqual(imgs, ["/uploads/mck.png", "/uploads/bain.png", "https://img.youtube.com/vi/abc123/hqdefault.jpg"]);
});

test("helper guard clauses run in order, and an unset env token means 'no logo', not a placeholder", async () => {
  const result = await extractPage(`
    const TOKEN = import.meta.env["VITE_LOGO_KEY"] as string | undefined;
    const STATIC_LOGOS: Record<string, string> = { harvard: "/uploads/harvard.webp", "iim calcutta": "/uploads/iimc.webp" };
    const STATIC_KEYS = Object.keys(STATIC_LOGOS).sort((a, b) => b.length - a.length);
    export function orgLogoUrl(org?: string, size = 128): string | undefined {
      if (!org) return undefined;
      const hay = org.toLowerCase();
      const staticKey = STATIC_KEYS.find((k) => hay.includes(k));
      if (staticKey) return STATIC_LOGOS[staticKey];
      if (!TOKEN) return undefined;
      return \`https://img.logo.dev/x?token=\${TOKEN}&size=\${size}\`;
    }
    function OrgLogo({ org }: { org: string }) {
      const url = orgLogoUrl(org, 128);
      const showLogo = Boolean(url);
      return <div>{showLogo ? <img src={url} alt={org} /> : <span className="wordmark">{org}</span>}</div>;
    }
    export default function Page() {
      return <main><OrgLogo org="Harvard Business School" /><OrgLogo org="Acme Robotics" /></main>;
    }
  `);
  const imgs = result.fields.filter((f) => f.type === "IMAGE").map((f) => f.defaultValue);
  assert.deepEqual(imgs, ["/uploads/harvard.webp"]);
  const marks = elements(result.tree).filter((e) => e.props.className === "wordmark");
  assert.equal(marks.length, 1);
  assert.equal(textOf(marks, result.fields), "Acme Robotics");
});
