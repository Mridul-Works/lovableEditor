import "server-only";
import { createHash } from "node:crypto";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import type * as t from "@babel/types";
import type {
  ExtractedField,
  FieldRef,
  ImportReport,
  PropValue,
  StyleValue,
  TreeNode,
} from "@/lib/tree";
import { FIELD_META_DESCRIPTION, FIELD_META_TITLE } from "@/lib/tree";
import { lucideIconNode } from "./lucide";

// Converts pasted Lovable/React component source into a JSON render tree plus
// editable content fields. The source is parsed as data with Babel — it is
// never evaluated, compiled, or executed. Anything dynamic (state, handlers,
// unresolvable expressions) is stripped and reported.

const traverse: typeof _traverse =
  (_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse;

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='500'%3E%3Crect width='100%25' height='100%25' fill='%23e2e8f0'/%3E%3Ctext x='50%25' y='50%25' fill='%2394a3b8' font-family='sans-serif' font-size='28' text-anchor='middle' dominant-baseline='middle'%3EReplace this image%3C/text%3E%3C/svg%3E";

const TEXT_PROPS = new Set(["alt", "title", "placeholder", "aria-label", "aria-description", "label"]);

const SECTION_KEYWORDS = [
  "hero", "nav", "navbar", "header", "footer", "feature", "features", "testimonial",
  "testimonials", "pricing", "faq", "cta", "contact", "about", "team", "stats",
  "gallery", "banner", "benefits", "services", "partners", "logos", "newsletter",
];

// Common shadcn/ui component names mapped to sensible HTML passthrough tags.
const COMPONENT_TAG_MAP: Record<string, string> = {
  Button: "button",
  Card: "div", CardContent: "div", CardHeader: "div", CardFooter: "div",
  CardTitle: "h3", CardDescription: "p",
  Badge: "span", Label: "label", Input: "input", Textarea: "textarea",
  Separator: "hr", Avatar: "div", AvatarImage: "img", AvatarFallback: "span",
  Accordion: "div", AccordionItem: "div", AccordionTrigger: "div", AccordionContent: "div",
  Tabs: "div", TabsList: "div", TabsTrigger: "button", TabsContent: "div",
  Dialog: "div", Sheet: "div", Tooltip: "span", ScrollArea: "div", AspectRatio: "div",
};

const VOID_TAGS = new Set([
  "img", "br", "hr", "input", "area", "base", "col", "embed", "link", "meta",
  "param", "source", "track", "wbr",
]);

type Scope = Map<string, t.Expression | number>;

type Ctx = {
  source: string;
  fields: ExtractedField[];
  usedKeys: Set<string>;
  report: ImportReport;
  scopes: Scope[];
  consts: Map<string, t.Expression>;
  /** local name → lucide icon component name */
  lucide: Map<string, string>;
  /** local name → import source, for image asset imports */
  assetImports: Map<string, string>;
  stateInits: Map<string, t.Expression | undefined>;
  section: string;
  sectionCounts: Map<string, number>;
  sort: { n: number };
  firstHeading?: string;
  firstParagraph?: string;
};

function hash4(input: string) {
  return createHash("sha1").update(input).digest("hex").slice(0, 4);
}

function snippet(ctx: Ctx, node: t.Node) {
  const raw = ctx.source.slice(node.start ?? 0, node.end ?? 0).replace(/\s+/g, " ").trim();
  return raw.length > 70 ? raw.slice(0, 67) + "..." : raw;
}

function note(ctx: Ctx, message: string) {
  if (!ctx.report.notes.includes(message)) ctx.report.notes.push(message);
}

function dropped(ctx: Ctx, node: t.Node) {
  const s = snippet(ctx, node);
  if (s && !ctx.report.droppedExpressions.includes(s)) ctx.report.droppedExpressions.push(s);
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  copy: "©", reg: "®", trade: "™", mdash: "—", ndash: "–",
  hellip: "…", rarr: "→", larr: "←", middot: "·", bull: "•",
};

function decodeEntities(text: string) {
  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, ent: string) => {
    if (ent.startsWith("#x") || ent.startsWith("#X")) return String.fromCodePoint(parseInt(ent.slice(2), 16));
    if (ent.startsWith("#")) return String.fromCodePoint(parseInt(ent.slice(1), 10));
    return ENTITIES[ent] ?? m;
  });
}

// ---------------------------------------------------------------------------
// Static expression resolution (data only — no evaluation of code)
// ---------------------------------------------------------------------------

function unwrap(expr: t.Expression): t.Expression {
  let e = expr;
  while (e.type === "ParenthesizedExpression" || e.type === "TSAsExpression" || e.type === "TSNonNullExpression" || e.type === "TSSatisfiesExpression") {
    e = e.expression;
  }
  return e;
}

/** Resolve an identifier/member expression to its literal AST value, if it is static data. */
function resolveExpr(expr: t.Expression, ctx: Ctx, depth = 0): t.Expression | number | undefined {
  if (depth > 12) return undefined;
  const e = unwrap(expr);

  if (e.type === "Identifier") {
    for (let i = ctx.scopes.length - 1; i >= 0; i--) {
      if (ctx.scopes[i].has(e.name)) return ctx.scopes[i].get(e.name);
    }
    if (ctx.stateInits.has(e.name)) {
      const init = ctx.stateInits.get(e.name);
      return init ? resolveExpr(init, ctx, depth + 1) ?? init : undefined;
    }
    const c = ctx.consts.get(e.name);
    if (c) {
      const r = resolveExpr(c, ctx, depth + 1);
      return r ?? c;
    }
    return undefined;
  }

  if (e.type === "MemberExpression") {
    const objRes = resolveExpr(e.object as t.Expression, ctx, depth + 1);
    if (typeof objRes === "number" || !objRes) return undefined;
    const obj = unwrap(objRes);
    let key: string | number | undefined;
    if (!e.computed && e.property.type === "Identifier") key = e.property.name;
    else if (e.property.type === "StringLiteral") key = e.property.value;
    else if (e.property.type === "NumericLiteral") key = e.property.value;
    if (key === undefined) return undefined;

    if (obj.type === "ObjectExpression") {
      for (const prop of obj.properties) {
        if (prop.type !== "ObjectProperty") continue;
        const name = prop.key.type === "Identifier" ? prop.key.name
          : prop.key.type === "StringLiteral" ? prop.key.value : undefined;
        if (name === String(key)) return resolveExpr(prop.value as t.Expression, ctx, depth + 1) ?? (prop.value as t.Expression);
      }
      return undefined;
    }
    if (obj.type === "ArrayExpression" && typeof key === "number") {
      const el = obj.elements[key];
      if (el && el.type !== "SpreadElement") return resolveExpr(el, ctx, depth + 1) ?? el;
      return undefined;
    }
    if (obj.type === "StringLiteral" && key === "length") return obj.value.length;
    if (obj.type === "ArrayExpression" && key === "length") return obj.elements.length;
    return undefined;
  }

  return e;
}

/** Literal JS value of a static expression (strings, numbers, booleans, null). */
function staticValue(expr: t.Expression, ctx: Ctx, depth = 0): string | number | boolean | null | undefined {
  if (depth > 12) return undefined;
  const resolved = resolveExpr(expr, ctx, depth);
  if (typeof resolved === "number") return resolved;
  if (!resolved) return undefined;
  const e = unwrap(resolved);

  switch (e.type) {
    case "StringLiteral": return e.value;
    case "NumericLiteral": return e.value;
    case "BooleanLiteral": return e.value;
    case "NullLiteral": return null;
    case "TemplateLiteral": {
      let out = "";
      for (let i = 0; i < e.quasis.length; i++) {
        out += e.quasis[i].value.cooked ?? e.quasis[i].value.raw;
        if (i < e.expressions.length) {
          const v = staticValue(e.expressions[i] as t.Expression, ctx, depth + 1);
          if (v === undefined) return undefined;
          out += String(v);
        }
      }
      return out;
    }
    case "UnaryExpression": {
      const v = staticValue(e.argument, ctx, depth + 1);
      if (v === undefined) return undefined;
      if (e.operator === "-") return -Number(v);
      if (e.operator === "!") return !v;
      return undefined;
    }
    case "BinaryExpression": {
      const l = staticValue(e.left as t.Expression, ctx, depth + 1);
      const r = staticValue(e.right, ctx, depth + 1);
      if (l === undefined || r === undefined) return undefined;
      switch (e.operator) {
        case "+": return (l as number) + (r as number);
        case ">": return (l as number) > (r as number);
        case "<": return (l as number) < (r as number);
        case ">=": return (l as number) >= (r as number);
        case "<=": return (l as number) <= (r as number);
        case "===": case "==": return l === r;
        case "!==": case "!=": return l !== r;
        default: return undefined;
      }
    }
    default: return undefined;
  }
}

/** Best-effort static string for className-like values. */
function staticClassName(expr: t.Expression, ctx: Ctx): { value: string; partial: boolean } {
  const e = unwrap(expr);
  const parts: string[] = [];
  let partial = false;

  const push = (x: t.Expression) => {
    const v = staticValue(x, ctx);
    if (typeof v === "string") parts.push(v);
    else if (v === undefined) {
      const inner = unwrap(x);
      if (inner.type === "ConditionalExpression") {
        const test = staticValue(inner.test as t.Expression, ctx);
        if (test !== undefined) push(test ? inner.consequent : inner.alternate);
        else {
          const c = staticValue(inner.consequent, ctx);
          if (typeof c === "string") { parts.push(c); partial = true; }
          else partial = true;
        }
      } else if (inner.type === "LogicalExpression") {
        const l = staticValue(inner.left as t.Expression, ctx);
        if (inner.operator === "&&") {
          if (l) push(inner.right);
          else if (l === undefined) partial = true;
        } else if (inner.operator === "||" || inner.operator === "??") {
          if (l !== undefined && l !== null && l !== false && l !== "") parts.push(String(l));
          else push(inner.right);
        }
      } else if (inner.type === "CallExpression") {
        for (const arg of inner.arguments) {
          if (arg.type === "SpreadElement" || arg.type === "ArgumentPlaceholder") { partial = true; continue; }
          push(arg as t.Expression);
        }
      } else if (inner.type === "TemplateLiteral") {
        // handled by staticValue when fully static; partially static:
        let out = "";
        for (let i = 0; i < inner.quasis.length; i++) {
          out += inner.quasis[i].value.cooked ?? "";
          if (i < inner.expressions.length) {
            const v2 = staticValue(inner.expressions[i] as t.Expression, ctx);
            if (v2 !== undefined) out += String(v2);
            else partial = true;
          }
        }
        parts.push(out);
      } else partial = true;
    }
  };

  push(e);
  return { value: parts.join(" ").replace(/\s+/g, " ").trim(), partial };
}

// ---------------------------------------------------------------------------
// Field creation
// ---------------------------------------------------------------------------

function makeKey(ctx: Ctx, tag: string, content: string) {
  const base = `${ctx.section}-${tag}-${hash4(content)}`;
  let key = base;
  let i = 2;
  while (ctx.usedKeys.has(key)) key = `${base}-${i++}`;
  ctx.usedKeys.add(key);
  return key;
}

function addField(ctx: Ctx, type: "TEXT" | "IMAGE", tag: string, defaultValue: string): string {
  const key = makeKey(ctx, tag, defaultValue);
  const label =
    type === "IMAGE"
      ? defaultValue.startsWith("data:") ? "Image (placeholder)" : defaultValue.split("/").pop()?.slice(0, 60) || "Image"
      : defaultValue.length > 60 ? defaultValue.slice(0, 57) + "..." : defaultValue;
  ctx.fields.push({ key, type, defaultValue, label, section: ctx.section, sortOrder: ctx.sort.n++ });
  if (type === "TEXT") ctx.report.textFields++;
  else ctx.report.imageFields++;
  return key;
}

// ---------------------------------------------------------------------------
// Attribute conversion
// ---------------------------------------------------------------------------

function normalizeAttrName(name: string, inSvg: boolean) {
  if (name === "class") return "className";
  if (name === "for") return "htmlFor";
  if (name.startsWith("data-") || name.startsWith("aria-")) return name;
  if (inSvg && name.includes("-") && !name.includes(":")) {
    return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  }
  return name;
}

function sanitizeUrl(url: string) {
  return /^\s*javascript:/i.test(url) ? "#" : url;
}

const BG_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/;

function convertStyle(obj: t.ObjectExpression, ctx: Ctx, tag: string): Record<string, StyleValue> {
  const style: Record<string, StyleValue> = {};
  for (const prop of obj.properties) {
    if (prop.type !== "ObjectProperty") { dropped(ctx, prop); continue; }
    const name = prop.key.type === "Identifier" ? prop.key.name
      : prop.key.type === "StringLiteral" ? prop.key.value : undefined;
    if (!name) continue;
    const v = staticValue(prop.value as t.Expression, ctx);
    if (v === undefined || v === null || typeof v === "boolean") {
      if (v === undefined) dropped(ctx, prop);
      continue;
    }
    if (typeof v === "string" && (name === "backgroundImage" || name === "background")) {
      const m = BG_URL_RE.exec(v);
      if (m) {
        const key = addField(ctx, "IMAGE", `${tag}-bg`, m[1]);
        style[name === "background" ? "backgroundImage" : name] = { $f: key };
        continue;
      }
    }
    style[name] = v;
  }
  return style;
}

type ConvertedProps = { props: Record<string, PropValue>; srcFieldKey?: string };

async function convertAttributes(
  attrs: Array<t.JSXAttribute | t.JSXSpreadAttribute>,
  tag: string,
  ctx: Ctx,
  inSvg: boolean,
): Promise<ConvertedProps> {
  const props: Record<string, PropValue> = {};
  let srcFieldKey: string | undefined;
  let hasSrcField = false;

  for (const attr of attrs) {
    if (attr.type === "JSXSpreadAttribute") { dropped(ctx, attr); continue; }
    const rawName =
      attr.name.type === "JSXNamespacedName"
        ? `${attr.name.namespace.name}:${attr.name.name.name}`
        : attr.name.name;
    const name = normalizeAttrName(rawName, inSvg);

    if (/^on[A-Z]/.test(name)) {
      if (!ctx.report.strippedHandlers.includes(name)) ctx.report.strippedHandlers.push(name);
      continue;
    }
    if (name === "ref" || name === "key") continue;
    if (name === "dangerouslySetInnerHTML") {
      note(ctx, "dangerouslySetInnerHTML was stripped");
      continue;
    }

    // No value → boolean true
    if (!attr.value) { props[name] = true; continue; }

    const valueExpr: t.Expression | undefined =
      attr.value.type === "StringLiteral"
        ? attr.value
        : attr.value.type === "JSXExpressionContainer" && attr.value.expression.type !== "JSXEmptyExpression"
          ? (attr.value.expression as t.Expression)
          : undefined;
    if (!valueExpr) continue;

    if (name === "style") {
      const resolved = resolveExpr(valueExpr, ctx);
      if (resolved && typeof resolved !== "number" && unwrap(resolved).type === "ObjectExpression") {
        props.style = convertStyle(unwrap(resolved) as t.ObjectExpression, ctx, tag);
      } else dropped(ctx, valueExpr);
      continue;
    }

    if (name === "className") {
      const { value, partial } = staticClassName(valueExpr, ctx);
      if (partial) dropped(ctx, valueExpr);
      if (value) props.className = value;
      continue;
    }

    const isImageSrc = (name === "src" && (tag === "img" || tag === "source" || tag === "image")) ||
      (name === "poster" && tag === "video");

    if (isImageSrc) {
      const v = staticValue(valueExpr, ctx);
      let url: string;
      if (typeof v === "string" && v.length > 0) {
        url = sanitizeUrl(v);
        if (url.startsWith("/") && !url.startsWith("/uploads/")) {
          note(ctx, `Image path "${url}" points at a Lovable project asset — replace it via the editor.`);
        }
      } else {
        const e = unwrap(valueExpr);
        const importName = e.type === "Identifier" ? e.name : snippet(ctx, valueExpr);
        note(ctx, `Image source "${importName}" could not be resolved (likely an imported asset file) — a placeholder was used; upload the real image in the editor.`);
        url = PLACEHOLDER_IMAGE;
      }
      const key = addField(ctx, "IMAGE", tag, url);
      props[name] = { $f: key } satisfies FieldRef;
      if (name === "src") { srcFieldKey = key; hasSrcField = true; }
      continue;
    }

    if (TEXT_PROPS.has(rawName) && attr.name.type !== "JSXNamespacedName") {
      const v = staticValue(valueExpr, ctx);
      if (typeof v === "string" && v.trim()) {
        const key = addField(ctx, "TEXT", `${tag}-${rawName.replace("aria-", "")}`, v);
        props[name] = { $f: key } satisfies FieldRef;
      } else if (typeof v === "string") {
        props[name] = v;
      } else dropped(ctx, valueExpr);
      continue;
    }

    if (name === "href" || name === "to" || name === "action" || name === "src") {
      const v = staticValue(valueExpr, ctx);
      if (typeof v === "string") props[name === "to" ? "href" : name] = sanitizeUrl(v);
      else dropped(ctx, valueExpr);
      continue;
    }

    const v = staticValue(valueExpr, ctx);
    if (v === undefined) { dropped(ctx, valueExpr); continue; }
    if (v === null) continue;
    props[name] = v;
  }

  if (hasSrcField) {
    delete props.srcSet;
    delete props.sizes;
  }
  return { props, srcFieldKey };
}

// ---------------------------------------------------------------------------
// JSX conversion
// ---------------------------------------------------------------------------

function jsxTextToString(raw: string): string | null {
  const text = raw.replace(/\r/g, "");
  if (/^\s*$/.test(text)) {
    // Whitespace-only: JSX keeps it (as a space) only when it contains no newline
    return text.includes("\n") ? null : " ";
  }
  let out = text.replace(/\s*\n\s*/g, " ");
  // JSX trims whitespace that touches a line break at the edges; the replace
  // above already collapsed those to single spaces, so trim edge spaces that
  // came from newlines:
  if (/^\s*\n/.test(text)) out = out.replace(/^ /, "");
  if (/\n\s*$/.test(text)) out = out.replace(/ $/, "");
  return out;
}

function isHeadingTag(tag: string) {
  return /^h[1-4]$/.test(tag);
}

async function convertChildren(
  children: Array<t.JSXElement | t.JSXFragment | t.JSXText | t.JSXExpressionContainer | t.JSXSpreadChild>,
  ctx: Ctx,
  parentTag: string,
  inSvg: boolean,
): Promise<TreeNode[]> {
  const out: TreeNode[] = [];
  for (const child of children) {
    out.push(...(await convertNode(child, ctx, parentTag, inSvg)));
  }
  // Drop leading/trailing pure-space nodes
  while (out.length && out[0].t === "x" && out[0].v.trim() === "") out.shift();
  while (out.length && out[out.length - 1].t === "x" && (out[out.length - 1] as { v: string }).v.trim() === "") out.pop();
  return out;
}

async function convertNode(
  node: t.Node,
  ctx: Ctx,
  parentTag: string,
  inSvg: boolean,
): Promise<TreeNode[]> {
  switch (node.type) {
    case "JSXText": {
      const text = jsxTextToString(node.value);
      if (text === null) return [];
      if (text.trim() === "") return [{ t: "x", v: " " }];
      const decoded = decodeEntities(text);
      recordContent(ctx, parentTag, decoded);
      const key = addField(ctx, "TEXT", parentTag, decoded);
      return [{ t: "f", k: key }];
    }

    case "JSXElement":
      return convertElement(node, ctx, inSvg);

    case "JSXFragment":
      return convertChildren(node.children, ctx, parentTag, inSvg);

    case "JSXExpressionContainer":
      return convertExpression(node.expression, ctx, parentTag, inSvg);

    case "JSXSpreadChild":
      dropped(ctx, node);
      return [];

    default:
      return [];
  }
}

function recordContent(ctx: Ctx, tag: string, text: string) {
  if (!ctx.firstHeading && isHeadingTag(tag) && text.trim().length > 2) ctx.firstHeading = text.trim();
  if (!ctx.firstParagraph && tag === "p" && text.trim().length > 20) ctx.firstParagraph = text.trim();
}

async function convertExpression(
  expr: t.Expression | t.JSXEmptyExpression,
  ctx: Ctx,
  parentTag: string,
  inSvg: boolean,
): Promise<TreeNode[]> {
  if (expr.type === "JSXEmptyExpression") return [];
  const e = unwrap(expr);

  if (e.type === "JSXElement" || e.type === "JSXFragment") return convertNode(e, ctx, parentTag, inSvg);

  // Literal-ish → text field
  const v = staticValue(e, ctx);
  if (typeof v === "string" || typeof v === "number") {
    const text = String(v);
    if (text.trim() === "") return text ? [{ t: "x", v: " " }] : [];
    recordContent(ctx, parentTag, text);
    const key = addField(ctx, "TEXT", parentTag, text);
    return [{ t: "f", k: key }];
  }
  if (v === null || v === false || v === true) return [];

  // {cond && <JSX/>}
  if (e.type === "LogicalExpression") {
    const left = staticValue(e.left as t.Expression, ctx);
    if (e.operator === "&&") {
      if (left) return convertExpression(e.right, ctx, parentTag, inSvg);
      if (left !== undefined) return [];
      dropped(ctx, e);
      note(ctx, "Conditional content depending on runtime state was omitted.");
      return [];
    }
    if (e.operator === "||" || e.operator === "??") {
      if (left !== undefined && left !== null && left !== false) {
        return convertExpression(e.left as t.Expression, ctx, parentTag, inSvg);
      }
      return convertExpression(e.right, ctx, parentTag, inSvg);
    }
  }

  // {cond ? <A/> : <B/>}
  if (e.type === "ConditionalExpression") {
    const test = staticValue(e.test as t.Expression, ctx);
    if (test !== undefined) return convertExpression(test ? e.consequent : e.alternate, ctx, parentTag, inSvg);
    note(ctx, "A runtime conditional was resolved to its first branch.");
    return convertExpression(e.consequent, ctx, parentTag, inSvg);
  }

  // {items.map((item, i) => <JSX/>)}
  if (e.type === "CallExpression" && e.callee.type === "MemberExpression" &&
      e.callee.property.type === "Identifier" && e.callee.property.name === "map") {
    const arrRes = resolveExpr(e.callee.object as t.Expression, ctx);
    const arr = arrRes && typeof arrRes !== "number" ? unwrap(arrRes) : undefined;
    const fn = e.arguments[0];
    if (arr?.type === "ArrayExpression" && fn &&
        (fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression")) {
      const itemParam = fn.params[0]?.type === "Identifier" ? fn.params[0].name : undefined;
      const indexParam = fn.params[1]?.type === "Identifier" ? fn.params[1].name : undefined;
      let body: t.Expression | undefined;
      if (fn.body.type !== "BlockStatement") body = fn.body;
      else {
        const ret = fn.body.body.find((s): s is t.ReturnStatement => s.type === "ReturnStatement");
        if (ret?.argument) body = ret.argument;
      }
      if (body) {
        const results: TreeNode[] = [];
        for (let i = 0; i < arr.elements.length; i++) {
          const el = arr.elements[i];
          if (!el || el.type === "SpreadElement") continue;
          const scope: Scope = new Map();
          if (itemParam) scope.set(itemParam, el as t.Expression);
          if (indexParam) scope.set(indexParam, i);
          ctx.scopes.push(scope);
          results.push(...(await convertExpression(body, ctx, parentTag, inSvg)));
          ctx.scopes.pop();
        }
        return results;
      }
    }
    dropped(ctx, e);
    note(ctx, "A .map() over non-literal data could not be expanded and was omitted.");
    return [];
  }

  dropped(ctx, e);
  return [];
}

function elementNameToString(name: t.JSXOpeningElement["name"]): string {
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXNamespacedName") return `${name.namespace.name}:${name.name.name}`;
  // JSXMemberExpression
  const parts: string[] = [];
  let cur: t.JSXMemberExpression | t.JSXIdentifier = name;
  while (cur.type === "JSXMemberExpression") {
    parts.unshift(cur.property.name);
    cur = cur.object;
  }
  parts.unshift(cur.name);
  return parts.join(".");
}

/** For <item.icon /> inside an expanded map: resolve to a lucide icon name. */
function resolveMemberIcon(name: t.JSXMemberExpression, ctx: Ctx): string | undefined {
  const asMember: t.MemberExpression = {
    type: "MemberExpression",
    object: jsxNameToExpr(name.object),
    property: { type: "Identifier", name: name.property.name } as t.Identifier,
    computed: false,
    optional: false,
  } as t.MemberExpression;
  const resolved = resolveExpr(asMember, ctx);
  if (resolved && typeof resolved !== "number") {
    const r = unwrap(resolved);
    if (r.type === "Identifier" && ctx.lucide.has(r.name)) return ctx.lucide.get(r.name);
  }
  return undefined;
}

function jsxNameToExpr(name: t.JSXMemberExpression | t.JSXIdentifier): t.Expression {
  if (name.type === "JSXIdentifier") return { type: "Identifier", name: name.name } as t.Identifier;
  return {
    type: "MemberExpression",
    object: jsxNameToExpr(name.object),
    property: { type: "Identifier", name: name.property.name } as t.Identifier,
    computed: false,
    optional: false,
  } as t.MemberExpression;
}

async function lucideFromAttrs(
  iconName: string,
  el: t.JSXElement,
  ctx: Ctx,
): Promise<TreeNode[]> {
  const extra: Record<string, string | number> = {};
  for (const attr of el.openingElement.attributes) {
    if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier") continue;
    const n = attr.name.name;
    if (/^on[A-Z]/.test(n)) continue;
    const valueExpr = !attr.value
      ? undefined
      : attr.value.type === "StringLiteral"
        ? attr.value
        : attr.value.type === "JSXExpressionContainer" && attr.value.expression.type !== "JSXEmptyExpression"
          ? (attr.value.expression as t.Expression)
          : undefined;
    if (!valueExpr) continue;
    if (n === "className") {
      const { value } = staticClassName(valueExpr, ctx);
      if (value) extra.className = value;
      continue;
    }
    const v = staticValue(valueExpr, ctx);
    if (typeof v === "string" || typeof v === "number") extra[n] = v;
  }
  const nodeEl = await lucideIconNode(iconName, extra);
  if (nodeEl) {
    if (!ctx.report.renderedIcons.includes(iconName)) ctx.report.renderedIcons.push(iconName);
    return [nodeEl];
  }
  note(ctx, `Icon "${iconName}" was not found in lucide-static — a placeholder was rendered.`);
  return [{
    t: "e", tag: "span",
    props: { className: typeof extra.className === "string" ? extra.className : "", "data-cms-icon-placeholder": iconName },
    children: [], from: `lucide:${iconName}`,
  }];
}

async function convertElement(el: t.JSXElement, ctx: Ctx, inSvg: boolean): Promise<TreeNode[]> {
  const nameStr = elementNameToString(el.openingElement.name);
  const name = el.openingElement.name;

  // <item.icon /> style dynamic icon
  if (name.type === "JSXMemberExpression") {
    const icon = resolveMemberIcon(name, ctx);
    if (icon) return lucideFromAttrs(icon, el, ctx);
    if (!ctx.report.unknownComponents.includes(nameStr)) ctx.report.unknownComponents.push(nameStr);
    const children = await convertChildren(el.children, ctx, "div", inSvg);
    return [{ t: "e", tag: "div", props: {}, children, from: nameStr }];
  }

  if (name.type === "JSXNamespacedName") return [];

  const isHtml = /^[a-z]/.test(nameStr);

  if (isHtml) {
    if (nameStr === "script") {
      note(ctx, "A <script> element was stripped.");
      return [];
    }
    const svgNow = inSvg || nameStr === "svg";
    const { props } = await convertAttributes(el.openingElement.attributes, nameStr, ctx, svgNow);
    const children = VOID_TAGS.has(nameStr) ? [] : await convertChildren(el.children, ctx, nameStr, svgNow);
    return [{ t: "e", tag: nameStr, props, children }];
  }

  // Component
  if (ctx.lucide.has(nameStr)) {
    return lucideFromAttrs(ctx.lucide.get(nameStr)!, el, ctx);
  }

  // A component held in map data, e.g. {Icon} resolved via scope
  {
    const resolved = resolveExpr({ type: "Identifier", name: nameStr } as t.Identifier, ctx);
    if (resolved && typeof resolved !== "number") {
      const r = unwrap(resolved);
      if (r.type === "Identifier" && ctx.lucide.has(r.name)) {
        return lucideFromAttrs(ctx.lucide.get(r.name)!, el, ctx);
      }
    }
  }

  if (nameStr === "Fragment") return convertChildren(el.children, ctx, "div", inSvg);

  if (nameStr === "Link") {
    const { props } = await convertAttributes(el.openingElement.attributes, "a", ctx, inSvg);
    const children = await convertChildren(el.children, ctx, "a", inSvg);
    if (!ctx.report.unknownComponents.includes("Link (rendered as <a>)")) {
      ctx.report.unknownComponents.push("Link (rendered as <a>)");
    }
    return [{ t: "e", tag: "a", props, children, from: "Link" }];
  }

  const mapped = COMPONENT_TAG_MAP[nameStr];
  const tag = mapped ?? "div";
  const { props } = await convertAttributes(el.openingElement.attributes, tag, ctx, inSvg);
  const children = await convertChildren(el.children, ctx, tag, inSvg);
  const label = mapped ? `${nameStr} (rendered as <${mapped}>)` : `${nameStr} (rendered as <div>)`;
  if (!ctx.report.unknownComponents.includes(label)) ctx.report.unknownComponents.push(label);
  if (!mapped && Object.keys(props).length === 0) {
    // Neutral wrapper that doesn't affect layout
    props.style = { display: "contents" };
  }
  return [{ t: "e", tag, props, children, from: nameStr }];
}

// ---------------------------------------------------------------------------
// Section naming
// ---------------------------------------------------------------------------

function sectionSlugFor(el: t.JSXElement | undefined, index: number, ctx: Ctx): string {
  let base = `section-${index + 1}`;
  if (el) {
    const name = el.openingElement.name;
    const tag = name.type === "JSXIdentifier" ? name.name : "";
    let hint = "";
    for (const attr of el.openingElement.attributes) {
      if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier") continue;
      if (attr.name.name !== "className" && attr.name.name !== "id") continue;
      let v = "";
      if (attr.value?.type === "StringLiteral") v = attr.value.value;
      else if (attr.value?.type === "JSXExpressionContainer" && attr.value.expression.type !== "JSXEmptyExpression") {
        v = staticClassName(attr.value.expression as t.Expression, ctx).value;
      }
      const lower = v.toLowerCase();
      for (const kw of SECTION_KEYWORDS) {
        if (lower.includes(kw)) { hint = kw; break; }
      }
      if (hint) break;
    }
    if (!hint && /^[A-Z]/.test(tag)) {
      const lower = tag.toLowerCase();
      for (const kw of SECTION_KEYWORDS) if (lower.includes(kw)) { hint = kw; break; }
    }
    if (!hint && ["header", "footer", "nav", "main", "aside"].includes(tag)) hint = tag;
    if (hint) base = hint;
  }
  const count = ctx.sectionCounts.get(base) ?? 0;
  ctx.sectionCounts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export type ExtractResult = {
  tree: TreeNode[];
  fields: ExtractedField[];
  report: ImportReport;
  title: string;
};

export async function extractPage(source: string): Promise<ExtractResult> {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
    errorRecovery: true,
  });

  const ctx: Ctx = {
    source,
    fields: [],
    usedKeys: new Set(),
    report: {
      textFields: 0, imageFields: 0, strippedHandlers: [], droppedExpressions: [],
      unknownComponents: [], renderedIcons: [], notes: [],
    },
    scopes: [],
    consts: new Map(),
    lucide: new Map(),
    assetImports: new Map(),
    stateInits: new Map(),
    section: "page",
    sectionCounts: new Map(),
    sort: { n: 0 },
  };

  let defaultExport: t.Node | undefined;
  const functions = new Map<string, t.FunctionDeclaration>();

  traverse(ast, {
    ImportDeclaration(path) {
      const src = path.node.source.value;
      for (const spec of path.node.specifiers) {
        if (src === "lucide-react" && spec.type === "ImportSpecifier") {
          const imported = spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value;
          ctx.lucide.set(spec.local.name, imported);
        } else if (/\.(png|jpe?g|svg|webp|gif|avif)$/i.test(src)) {
          ctx.assetImports.set(spec.local.name, src);
        }
      }
    },
    VariableDeclaration(path) {
      // Module-level and component-body consts both become resolvable data.
      for (const decl of path.node.declarations) {
        if (decl.id.type === "Identifier" && decl.init) {
          ctx.consts.set(decl.id.name, decl.init);
        } else if (
          decl.id.type === "ArrayPattern" &&
          decl.init?.type === "CallExpression" &&
          decl.init.callee.type === "Identifier" &&
          decl.init.callee.name === "useState"
        ) {
          const [stateId] = decl.id.elements;
          if (stateId?.type === "Identifier") {
            ctx.stateInits.set(stateId.name, decl.init.arguments[0] as t.Expression | undefined);
          }
        }
      }
    },
    FunctionDeclaration(path) {
      if (path.node.id && path.parent.type === "Program") functions.set(path.node.id.name, path.node);
    },
    ExportDefaultDeclaration(path) {
      defaultExport = path.node.declaration;
    },
  });

  // Locate the component function
  let component: t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression | undefined;
  const asFn = (n: t.Node | undefined) =>
    n && (n.type === "FunctionDeclaration" || n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression")
      ? n : undefined;

  component = asFn(defaultExport);
  if (!component && defaultExport?.type === "Identifier") {
    component = functions.get(defaultExport.name) ?? asFn(ctx.consts.get(defaultExport.name));
  }
  if (!component) {
    // Fallback: first top-level function that returns JSX
    for (const fn of functions.values()) { component = fn; break; }
    if (!component) {
      for (const init of ctx.consts.values()) {
        const fn = asFn(init);
        if (fn) { component = fn; break; }
      }
    }
  }
  if (!component) throw new Error("Could not find a React component in the pasted code. Paste the full exported page component.");

  // Find the returned JSX
  let rootExpr: t.Expression | undefined;
  if (component.body.type !== "BlockStatement") {
    rootExpr = component.body;
  } else {
    for (const stmt of component.body.body) {
      if (stmt.type === "ReturnStatement" && stmt.argument) rootExpr = stmt.argument;
    }
  }
  if (!rootExpr) throw new Error("The component has no return statement with JSX.");
  rootExpr = unwrap(rootExpr);
  if (rootExpr.type !== "JSXElement" && rootExpr.type !== "JSXFragment") {
    throw new Error("The component does not return JSX.");
  }

  if (/useState|useEffect|useRef|useReducer/.test(source)) {
    note(ctx, "React state/effects were stripped — interactive behavior is not preserved by design.");
  }

  // Find the section container: descend through single-child wrappers.
  type JsxParent = t.JSXElement | t.JSXFragment;
  const elementChildren = (n: JsxParent) =>
    n.children.filter(
      (c): c is t.JSXElement | t.JSXExpressionContainer =>
        c.type === "JSXElement" ||
        (c.type === "JSXExpressionContainer" && c.expression.type !== "JSXEmptyExpression"),
    );

  let container: JsxParent = rootExpr;
  const wrappers: t.JSXElement[] = [];
  while (container.type === "JSXElement") {
    const kids = elementChildren(container);
    if (kids.length === 1 && kids[0].type === "JSXElement") {
      wrappers.push(container);
      container = kids[0];
    } else break;
  }

  // Convert: wrappers keep their own props; the container's children are the sections.
  const sections = container.type === "JSXElement" ? container.children : container.children;
  const sectionNodes: TreeNode[] = [];
  let sectionIndex = 0;
  for (const child of sections) {
    if (child.type === "JSXText") {
      const text = jsxTextToString(child.value);
      if (text === null || text.trim() === "") continue;
    }
    const el = child.type === "JSXElement" ? child : undefined;
    ctx.section = sectionSlugFor(el, sectionIndex, ctx);
    sectionIndex++;
    sectionNodes.push(...(await convertNode(child, ctx, "div", false)));
  }

  // Rebuild wrapper chain (outermost first)
  let tree: TreeNode[] = sectionNodes;
  const wrapperChain = container.type === "JSXElement" ? [...wrappers, container] : wrappers;
  for (let i = wrapperChain.length - 1; i >= 0; i--) {
    ctx.section = "page";
    const el = wrapperChain[i];
    const nameStr = elementNameToString(el.openingElement.name);
    const isHtml = /^[a-z]/.test(nameStr) && el.openingElement.name.type === "JSXIdentifier";
    const tag = isHtml ? nameStr : COMPONENT_TAG_MAP[nameStr] ?? "div";
    if (!isHtml && !ctx.report.unknownComponents.includes(`${nameStr} (rendered as <${tag}>)`)) {
      ctx.report.unknownComponents.push(`${nameStr} (rendered as <${tag}>)`);
    }
    const { props } = await convertAttributes(el.openingElement.attributes, tag, ctx, false);
    tree = [{ t: "e", tag, props, children: tree, ...(isHtml ? {} : { from: nameStr }) }];
  }

  // Meta fields, always present, first in sort order.
  const title = ctx.firstHeading ?? "Untitled page";
  ctx.fields.unshift(
    {
      key: FIELD_META_TITLE, type: "TEXT", defaultValue: title,
      label: "Meta title", section: "meta", sortOrder: -2,
    },
    {
      key: FIELD_META_DESCRIPTION, type: "TEXT", defaultValue: ctx.firstParagraph?.slice(0, 160) ?? "",
      label: "Meta description", section: "meta", sortOrder: -1,
    },
  );

  return { tree, fields: ctx.fields, report: ctx.report, title };
}

export function normalizeRoute(input: string): string {
  let route = input.trim().toLowerCase();
  if (!route.startsWith("/")) route = "/" + route;
  route = route.replace(/\/+/g, "/");
  if (route.length > 1 && route.endsWith("/")) route = route.slice(0, -1);
  if (!/^\/[a-z0-9\-_/]*$/.test(route)) {
    throw new Error("Route may only contain lowercase letters, numbers, hyphens and slashes.");
  }
  const first = route.split("/")[1] ?? "";
  if (["admin", "uploads", "api", "_next"].includes(first)) {
    throw new Error(`Route /${first} is reserved.`);
  }
  return route;
}
