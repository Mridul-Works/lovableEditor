import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RenderTree } from "./RenderTree";
import type { TreeNode } from "@/lib/tree";

// The tree is data we render verbatim, so the renderer is the last line of
// defence between a stored page and the browser.

function render(tree: TreeNode[], values: Record<string, string> = {}) {
  return renderToStaticMarkup(<RenderTree tree={tree} values={values} />);
}

const el = (tag: string, props: Record<string, unknown> = {}, children: TreeNode[] = []): TreeNode =>
  ({ t: "e", tag, props, children }) as TreeNode;

test("ordinary markup and field values render", () => {
  const html = render([el("h1", { className: "title" }, [{ t: "f", k: "k1" }])], { k1: "Hello" });
  assert.match(html, /<h1[^>]*class="title"[^>]*>Hello<\/h1>/);
});

test("dangerous URL schemes are neutralised", () => {
  for (const href of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
  ]) {
    const html = render([el("a", { href }, [{ t: "x", v: "link" }])]);
    assert.doesNotMatch(html, /javascript:|vbscript:|data:text\/html/i, `not neutralised: ${href}`);
  }
});

test("ordinary URLs are left intact", () => {
  for (const href of ["https://example.com/x", "/about", "#anchor", "mailto:a@b.co", "?q=1"]) {
    const html = render([el("a", { href }, [{ t: "x", v: "link" }])]);
    assert.ok(html.includes(href), `rewrote a safe URL: ${href}`);
  }
});

test("protocol-relative URLs are neutralised", () => {
  const html = render([el("a", { href: "//evil.example/x" }, [{ t: "x", v: "link" }])]);
  assert.doesNotMatch(html, /\/\/evil\.example/);
});

test("code-bearing tags are dropped even if stored in a tree", () => {
  for (const tag of ["script", "iframe", "object", "embed", "link", "meta", "style", "base"]) {
    const html = render([el("div", {}, [el(tag, { src: "/x.js" }, [])])]);
    assert.doesNotMatch(html, new RegExp(`<${tag}`, "i"), `${tag} was rendered`);
  }
});

test("event handlers and raw HTML props never reach the DOM", () => {
  const html = render([
    el("button", { onClick: "alert(1)", dangerouslySetInnerHTML: { __html: "<b>x</b>" } }, [
      { t: "x", v: "Click" },
    ]),
  ]);
  assert.doesNotMatch(html, /onclick|alert\(1\)/i);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test("inline media data URLs still load as image sources", () => {
  // The importer uses a data: URI for its placeholder image, and blocking
  // data: outright left every unresolved image rendering as src="#".
  const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E";
  const html = render([el("img", { src: placeholder })]);
  assert.ok(html.includes("data:image/svg+xml"), "placeholder image was rewritten");

  // ...but the same scheme in a link is still a navigation target.
  const link = render([el("a", { href: "data:text/html,<script>alert(1)</script>" }, [])]);
  assert.doesNotMatch(link, /data:text\/html/i);
});

test("a field-backed image URL is sanitised too", () => {
  const html = render([el("img", { src: { $f: "img" } })], { img: "javascript:alert(1)" });
  assert.doesNotMatch(html, /javascript:/i);
});

test("field-backed links, videos and backgrounds are announced for the editor", () => {
  const html = render(
    [
      el("a", { href: { $f: "cta-a-1" } }, [{ t: "f", k: "cta-a-2" }]),
      el("video", { src: { $f: "hero-video-1" } }),
      el("div", { style: { backgroundImage: { $f: "hero-div-bg-1" } } }),
    ],
    { "cta-a-1": "https://example.com/apply", "cta-a-2": "Apply", "hero-video-1": "/uploads/x.mp4", "hero-div-bg-1": "/uploads/y.jpg" },
  );
  assert.match(html, /<a[^>]*data-cms-href="cta-a-1"[^>]*href="https:\/\/example.com\/apply"[^>]*data-cms-field="cta-a-2"/);
  assert.match(html, /<video[^>]*src="\/uploads\/x.mp4"[^>]*data-cms-type="video"/);
  assert.match(html, /<div[^>]*data-cms-bg="hero-div-bg-1"[^>]*style="background-image:url\(&quot;\/uploads\/y.jpg&quot;\)"/);
});
