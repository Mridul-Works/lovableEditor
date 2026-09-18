import { createElement, type CSSProperties, type ReactNode } from "react";
import { safeUrl } from "@/lib/safe-url";
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

function resolveProp(
  name: string,
  value: PropValue,
  values: Record<string, string>,
): { value: unknown; fieldKey?: string; bgFieldKeys?: string[] } {
  if (isFieldRef(value)) {
    const resolved = values[value.$f] ?? "";
    if (name === "src" || name === "poster") return { value: safeUrl(resolved, "src"), fieldKey: value.$f };
    if (name === "href") return { value: safeUrl(resolved, "href"), fieldKey: value.$f };
    return { value: resolved, fieldKey: value.$f };
  }
  if (name === "style" && typeof value === "object") {
    const style: CSSProperties = {};
    const bgFieldKeys: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      if (isFieldRef(v)) {
        const url = values[v.$f] ?? "";
        (style as Record<string, unknown>)[k] = `url("${safeUrl(url, "src").replace(/"/g, "%22")}")`;
        bgFieldKeys.push(v.$f);
      } else {
        (style as Record<string, unknown>)[k] = v;
      }
    }
    return { value: style, bgFieldKeys };
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

  // Every field-backed attribute is announced on the element, so the on-page
  // editor and the live preview can find and update it without knowing the
  // tree: data-cms-field/-type for the element's own content (text, image,
  // video), data-cms-href for its link target, data-cms-bg for a CSS background.
  for (const [name, raw] of Object.entries(node.props)) {
    if (BLOCKED_PROPS.has(name) || /^on[A-Z]/.test(name)) continue;
    const { value, fieldKey, bgFieldKeys } = resolveProp(name, raw, values);
    if (name === "src" && fieldKey) srcFieldKey = fieldKey;
    if (name === "href" && fieldKey) props["data-cms-href"] = fieldKey;
    if (name === "poster" && fieldKey) props["data-cms-poster"] = fieldKey;
    if (bgFieldKeys?.length) props["data-cms-bg"] = bgFieldKeys[0];
    props[name] = value;
  }

  if (srcFieldKey) {
    props["data-cms-field"] = srcFieldKey;
    props["data-cms-type"] = node.tag === "video" || node.tag === "audio" ? "video" : "image";
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
