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
const BLOCKED_TAGS = new Set(["script", "object", "applet", "base"]);

const BLOCKED_PROPS = new Set(["dangerouslySetInnerHTML", "srcDoc", "ref", "key", "children"]);

function safeUrl(value: string): string {
  return /^\s*javascript:/i.test(value) ? "#" : value;
}

function resolveProp(
  name: string,
  value: PropValue,
  values: Record<string, string>,
): { value: unknown; fieldKey?: string } {
  if (isFieldRef(value)) {
    const resolved = values[value.$f] ?? "";
    return { value: name === "src" || name === "href" ? safeUrl(resolved) : resolved, fieldKey: value.$f };
  }
  if (name === "style" && typeof value === "object") {
    const style: CSSProperties = {};
    for (const [k, v] of Object.entries(value)) {
      if (isFieldRef(v)) {
        const url = values[v.$f] ?? "";
        (style as Record<string, unknown>)[k] = `url("${safeUrl(url).replace(/"/g, "%22")}")`;
      } else {
        (style as Record<string, unknown>)[k] = v;
      }
    }
    return { value: style };
  }
  if ((name === "href" || name === "src" || name === "action") && typeof value === "string") {
    return { value: safeUrl(value) };
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
