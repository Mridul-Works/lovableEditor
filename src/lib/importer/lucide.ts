import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ElementNode } from "@/lib/tree";

// Renders a lucide icon as an inline-SVG tree node by reading the icon's
// static SVG from lucide-static at import time. No lucide code runs at
// request time — the SVG is baked into the page tree as data.

function kebab(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])(\d)/g, "$1-$2")
    .toLowerCase();
}

function camelAttr(name: string) {
  if (name === "class") return "className";
  if (name.startsWith("data-") || name.startsWith("aria-") || name.includes(":")) return name;
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * lucide exports every icon under aliases too — `ImageIcon`, `LucideImage`,
 * `XIcon` — and dropped its brand icons (Instagram, Linkedin, Youtube, Twitter,
 * Facebook, Github, ...) in v1. Lovable projects still import both, so the
 * lookup tries the alias spellings and falls back to the last release that
 * shipped the brand set.
 */
async function readIconSvg(componentName: string): Promise<string | null> {
  const candidates = [componentName];
  if (/Icon$/.test(componentName) && componentName.length > 4) candidates.push(componentName.replace(/Icon$/, ""));
  if (/^Lucide[A-Z]/.test(componentName)) candidates.push(componentName.replace(/^Lucide/, ""));
  for (const pkg of ["lucide-static", "lucide-static-legacy"]) {
    for (const name of candidates) {
      const file = path.join(process.cwd(), "node_modules", pkg, "icons", `${kebab(name)}.svg`);
      try {
        return await readFile(file, "utf8");
      } catch {
        // try the next spelling / package
      }
    }
  }
  return null;
}

/**
 * Minimal XML element parser sufficient for lucide-static's machine-generated
 * SVGs (flat, double-quoted attributes, no comments/CDATA/text content).
 */
function parseSvg(svg: string): ElementNode | null {
  const tagRe = /<(\w[\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/)?>|<\/(\w[\w-]*)\s*>/g;
  const attrRe = /([\w:-]+)="([^"]*)"/g;
  const stack: ElementNode[] = [];
  let root: ElementNode | null = null;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(svg))) {
    const [, open, attrText, selfClosed, close] = m;
    if (open) {
      const props: ElementNode["props"] = {};
      let a: RegExpExecArray | null;
      attrRe.lastIndex = 0;
      while ((a = attrRe.exec(attrText ?? ""))) {
        if (a[1] === "xmlns") continue;
        props[camelAttr(a[1])] = a[2];
      }
      const node: ElementNode = { t: "e", tag: open, props, children: [] };
      if (stack.length > 0) stack[stack.length - 1].children.push(node);
      else root = node;
      if (!selfClosed) stack.push(node);
    } else if (close) {
      stack.pop();
    }
  }
  return root;
}

export async function lucideIconNode(
  componentName: string,
  extraProps: Record<string, string | number>,
): Promise<ElementNode | null> {
  const svg = await readIconSvg(componentName);
  if (svg === null) return null;
  const node = parseSvg(svg);
  if (!node || node.tag !== "svg") return null;

  const { size, className, color, strokeWidth, ...rest } = extraProps;
  if (size !== undefined) {
    node.props.width = size;
    node.props.height = size;
  }
  if (className !== undefined) {
    const own = typeof node.props.className === "string" ? node.props.className : "";
    node.props.className = own ? `${own} ${className}` : String(className);
  }
  if (color !== undefined) node.props.stroke = String(color);
  if (strokeWidth !== undefined) node.props.strokeWidth = strokeWidth;
  for (const [k, v] of Object.entries(rest)) node.props[k] = v;
  node.from = `lucide:${componentName}`;
  return node;
}
