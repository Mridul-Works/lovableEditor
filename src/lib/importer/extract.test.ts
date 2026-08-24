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
