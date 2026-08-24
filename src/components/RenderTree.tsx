import { createElement, type CSSProperties, type ReactNode } from "react";
import { isFieldRef, type ElementNode, type PropValue, type TreeNode } from "@/lib/tree";

// Renders a page's JSON tree. Field references are resolved against the
// `values` map (current value, falling back to defaultValue — built by the
// caller). Everything here is data → DOM; no imported code ever runs.

const VOID_TAGS = new Set([
  "img", "br", "hr", "input", "area", "base", "col", "embed", "link", "meta",
  "param", "source", "track", "wbr",
]);

// Tags whose rendering would execute or fetch code — never emitted even if
// they somehow ended up in a stored tree.
// Tags that execute code, pull in remote documents, or restyle/retarget the
// whole page. A stored tree is data we render verbatim, so the guard list has
// to cover more than just <script>.
const BLOCKED_TAGS = new Set([
  "script", "object", "applet", "base", "iframe", "embed", "frame", "frameset",
  "link", "meta", "style", "noscript", "portal",
]);

const BLOCKED_PROPS = new Set(["dangerouslySetInnerHTML", "srcDoc", "ref", "key", "children"]);

// Allowlist rather than a denylist: `data:text/html`, `vbscript:` and
// tab-obfuscated `java<TAB>script:` all slip past a `javascript:` test, since
// browsers strip whitespace inside a scheme before resolving it.
const SAFE_SCHEME = /^(https?|mailto|tel|ftp):/i;
// Inline media is safe to *load*; `data:text/html` is only dangerous when a
// link navigates to it, so what counts as safe depends on the attribute.
const SAFE_MEDIA_DATA = /^data:(image|video|audio|font)\//i;

function safeUrl(value: string, kind: "src" | "href" = "href"): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  // Protocol-relative URLs silently inherit the scheme and leave the origin.
  if (trimmed.startsWith("//")) return "#";
  // Relative, root-relative, anchor and query URLs carry no scheme at all.
  if (/^[.#/?]/.test(trimmed)) return trimmed;
  // The scheme is everything up to the first ":", ignoring the control
  // characters and whitespace a browser strips before resolving it.
  const stripped = trimmed.replace(/[\s\u0000-\u001F]/g, "");
  if (!stripped.includes(":")) return trimmed;
  if (SAFE_SCHEME.test(stripped)) return trimmed;
  if (kind === "src" && (SAFE_MEDIA_DATA.test(stripped) || /^blob:/i.test(stripped))) return trimmed;
  return "#";
}

function resolveProp(
  name: string,
  value: PropValue,
  values: Record<string, string>,
): { value: unknown; fieldKey?: string } {
  if (isFieldRef(value)) {
    const resolved = values[value.$f] ?? "";
    if (name === "src" || name === "poster") return { value: safeUrl(resolved, "src"), fieldKey: value.$f };
    if (name === "href") return { value: safeUrl(resolved, "href"), fieldKey: value.$f };
    return { value: resolved, fieldKey: value.$f };
  }
  if (name === "style" && typeof value === "object") {
    const style: CSSProperties = {};
    for (const [k, v] of Object.entries(value)) {
      if (isFieldRef(v)) {
        const url = values[v.$f] ?? "";
        (style as Record<string, unknown>)[k] = `url("${safeUrl(url, "src").replace(/"/g, "%22")}")`;
      } else {
        (style as Record<string, unknown>)[k] = v;
      }
    }
    return { value: style };
  }
  if ((name === "src" || name === "poster" || name === "srcSet") && typeof value === "string") {
    return { value: safeUrl(value, "src") };
  }
  if ((name === "href" || name === "action" || name === "formAction") && typeof value === "string") {
    return { value: safeUrl(value, "href") };
  }
  return { value };
}

function renderElement(
  node: ElementNode,
  values: Record<string, string>,
  key: string,
): ReactNode {
  if (BLOCKED_TAGS.has(node.tag)) return null;

  const props: Record<string, unknown> = { key };
  let srcFieldKey: string | undefined;

  for (const [name, raw] of Object.entries(node.props)) {
    if (BLOCKED_PROPS.has(name) || /^on[A-Z]/.test(name)) continue;
    const { value, fieldKey } = resolveProp(name, raw, values);
    if (name === "src" && fieldKey) srcFieldKey = fieldKey;
    props[name] = value;
  }

  if (srcFieldKey) {
    props["data-cms-field"] = srcFieldKey;
    props["data-cms-type"] = "image";
  }

  if (VOID_TAGS.has(node.tag)) {
    return createElement(node.tag, props);
  }

  // If the element's only child is a single text field, mark the element
  // itself editable; otherwise wrap each field child in a span.
  const fieldChildren = node.children.filter((c) => c.t === "f");
  const soleField = node.children.length === 1 && fieldChildren.length === 1
    ? (node.children[0] as { t: "f"; k: string })
    : null;

  if (soleField && !srcFieldKey) {
    props["data-cms-field"] = soleField.k;
    props["data-cms-type"] = "text";
    return createElement(node.tag, props, values[soleField.k] ?? "");
  }

  const children = node.children.map((child, i) => renderNode(child, values, `${key}.${i}`));
  return createElement(node.tag, props, ...children);
}

function renderNode(node: TreeNode, values: Record<string, string>, key: string): ReactNode {
  switch (node.t) {
    case "x":
      return node.v;
    case "f":
      return createElement(
        "span",
        { key, "data-cms-field": node.k, "data-cms-type": "text" },
        values[node.k] ?? "",
      );
    case "e":
      return renderElement(node, values, key);
    default:
      return null;
  }
}

export function RenderTree({
  tree,
  values,
}: {
  tree: TreeNode[];
  values: Record<string, string>;
}) {
  return <>{tree.map((node, i) => renderNode(node, values, `n.${i}`))}</>;
}
