import "server-only";
import { createHash } from "node:crypto";
import { parse } from "@babel/parser";
import type * as t from "@babel/types";
import { twMerge } from "tailwind-merge";
import type {
  ExtractedField,
  FieldRef,
  FieldType,
  ImportReport,
  PropValue,
  StyleValue,
  TreeNode,
} from "@/lib/tree";
import { FIELD_META_DESCRIPTION, FIELD_META_TITLE, isFieldRef } from "@/lib/tree";
import { lucideIconNode } from "./lucide";

// Converts pasted Lovable/React component source into a JSON render tree plus
// editable content fields. The source is parsed as data with Babel — it is
// never evaluated, compiled, or executed. Anything dynamic (state, handlers,
// unresolvable expressions) is stripped and reported.

// Note: the collection pass below uses a plain recursive walk instead of
// @babel/traverse — traverse builds bindings and throws on the duplicate
// declarations that concatenated multi-file pastes legitimately contain
// (the same component imported in one file and declared in another).
function walk(node: unknown, visit: (n: t.Node) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const n = node as t.Node & Record<string, unknown>;
  if (typeof n.type !== "string") return;
  visit(n);
  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    walk(n[key], visit);
  }
}

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='500'%3E%3Crect width='100%25' height='100%25' fill='%23e2e8f0'/%3E%3Ctext x='50%25' y='50%25' fill='%2394a3b8' font-family='sans-serif' font-size='28' text-anchor='middle' dominant-baseline='middle'%3EReplace this image%3C/text%3E%3C/svg%3E";

const TEXT_PROPS = new Set(["alt", "title", "placeholder", "aria-label", "aria-description", "label"]);

/**
 * Import specifiers that are media rather than code. Two shapes exist in
 * Lovable exports: the file itself (`import hero from "@/assets/hero.webp"`,
 * a URL string at runtime) and, in newer projects, a JSON sidecar
 * (`import hero from "@/assets/hero.webp.asset.json"`, an object whose `.url`
 * is the hosted file). Both have to resolve statically wherever the identifier
 * ends up: a data array, an object property, a template literal.
 */
const ASSET_FILE_RE = /\.(png|jpe?g|svg|webp|gif|avif|mp4|webm|mov|m4v|ogg|mp3|wav|pdf)(\?[\w=&]*)?$/i;
const ASSET_SIDECAR_RE = /\.asset\.json$/i;

export function isAssetSpecifier(spec: string) {
  return ASSET_FILE_RE.test(spec) || ASSET_SIDECAR_RE.test(spec);
}

function isImageSpecifier(spec: string) {
  return /\.(png|jpe?g|svg|webp|gif|avif)(\.asset\.json)?(\?[\w=&]*)?$/i.test(spec);
}

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

/** Overlay bodies that stay closed without interaction. */
const CLOSED_OVERLAYS = new Set([
  "DialogContent", "AlertDialogContent", "SheetContent", "DrawerContent", "PopoverContent",
  "DropdownMenuContent", "ContextMenuContent", "MenubarContent", "HoverCardContent",
  "TooltipContent", "SelectContent", "CommandDialog",
]);

/** Props an unknown component may forward onto the plain element standing in for it. */
const PASSTHROUGH_PROPS = new Set([
  "className", "id", "style", "role", "title", "tabIndex", "href", "target", "rel", "src", "alt",
  "name", "htmlFor", "disabled", "placeholder", "defaultValue", "defaultChecked", "width", "height",
  "loading", "colSpan", "rowSpan", "lang", "dir", "hidden", "variant", "size", "asChild",
]);

// framer-motion / motion primitives: <motion.div>, <m.section>, <motion.a>.
// The namespace object is the animation library; the property is a real tag.
const MOTION_NAMESPACES = new Set(["motion", "m"]);

/** Props that only exist for the animation runtime and mean nothing statically. */
const MOTION_PROPS = [
  "initial", "animate", "exit", "transition", "variants", "viewport",
  "whileInView", "whileHover", "whileTap", "whileFocus", "whileDrag",
  "layout", "layoutId", "layoutScroll", "layoutRoot", "layoutDependency",
  "drag", "dragConstraints", "dragElastic", "dragMomentum", "dragSnapToOrigin",
  "custom", "inherit", "onAnimationStart", "onAnimationComplete", "onUpdate",
];

function motionElementTag(name: t.JSXMemberExpression): string | undefined {
  if (name.object.type !== "JSXIdentifier" || !MOTION_NAMESPACES.has(name.object.name)) return undefined;
  const tag = name.property.name;
  return /^[a-z][a-z0-9-]*$/.test(tag) ? tag : undefined;
}

const VOID_TAGS = new Set([
  "img", "br", "hr", "input", "area", "base", "col", "embed", "link", "meta",
  "param", "source", "track", "wbr",
]);

// Default shadcn/ui classes, so passthrough components keep their real look
// even though components/ui/*.tsx is never bundled or executed. Mirrors the
// stock shadcn styles Lovable generates. Instance className wins via twMerge.
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors";
const BUTTON_VARIANTS: Record<string, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  link: "text-primary underline-offset-4 hover:underline",
};
const BUTTON_SIZES: Record<string, string> = {
  default: "h-10 px-4 py-2",
  sm: "h-9 rounded-md px-3",
  lg: "h-11 rounded-md px-8",
  icon: "h-10 w-10",
};
const BADGE_BASE =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors";
const BADGE_VARIANTS: Record<string, string> = {
  default: "border-transparent bg-primary text-primary-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  destructive: "border-transparent bg-destructive text-destructive-foreground",
  outline: "text-foreground",
};
const SHADCN_STATIC_CLASSES: Record<string, string> = {
  Card: "rounded-lg border bg-card text-card-foreground shadow-sm",
  CardHeader: "flex flex-col space-y-1.5 p-6",
  CardTitle: "text-2xl font-semibold leading-none tracking-tight",
  CardDescription: "text-sm text-muted-foreground",
  CardContent: "p-6 pt-0",
  CardFooter: "flex items-center p-6 pt-0",
  Input:
    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground md:text-sm",
  Textarea:
    "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground md:text-sm",
  Label: "text-sm font-medium leading-none",
  Separator: "shrink-0 bg-border h-[1px] w-full border-0",
  Avatar: "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
  AvatarImage: "aspect-square h-full w-full",
  AvatarFallback: "flex h-full w-full items-center justify-center rounded-full bg-muted",
};

function shadcnDefaultClasses(name: string, props: Record<string, unknown>): string | undefined {
  if (name === "Button") {
    const variant = typeof props.variant === "string" ? props.variant : "default";
    const size = typeof props.size === "string" ? props.size : "default";
    return twMerge(BUTTON_BASE, BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.default, BUTTON_SIZES[size] ?? BUTTON_SIZES.default);
  }
  if (name === "Badge") {
    const variant = typeof props.variant === "string" ? props.variant : "default";
    return twMerge(BADGE_BASE, BADGE_VARIANTS[variant] ?? BADGE_VARIANTS.default);
  }
  return SHADCN_STATIC_CLASSES[name];
}

type Scope = Map<string, t.Expression | number>;

type ComponentFn = t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression;

/** One inlining level's `children`, and whether the body actually rendered them. */
type ChildrenFrame = { nodes: TreeNode[]; used: boolean };

type Ctx = {
  /** Components defined in the pasted source itself — inlined during conversion. */
  localComponents: Map<string, ComponentFn>;
  /** Names currently being inlined, to break recursion. */
  inlineStack: string[];
  /** Every function declared in the source, for resolving data-helper calls. */
  functions: Map<string, ComponentFn>;
  /** Helper calls being resolved, to break recursion. */
  callStack: string[];
  /** Children handed to the component being inlined, for its {children} slot. */
  childrenStack: ChildrenFrame[];
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
  /** import specifier (as written) → uploaded URL, provided by the GitHub bundler */
  assetUrls: Map<string, string>;
  /** Synthesized literal per asset import, so every reference sees one node. */
  assetLiterals: Map<string, t.Expression>;
  /** Wrappers whose children are the page's real sections (see isSectionWrapper). */
  sectionWrappers: Set<t.JSXElement | t.JSXFragment>;
  /** Elements that are sections themselves; a childless component here may hold sub-sections. */
  sectionRoots: Set<t.JSXElement>;
  /** `import { pgpHero as hero }` — local name → exported name, with the import's offset. */
  importAliases: Array<{ local: string; imported: string; at: number }>;
  /** Start offsets of the files a bundle was concatenated from (ascending). */
  fileStarts: number[];
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
  return deoptional(e);
}

/**
 * `a?.b` and `a?.b()` evaluate like `a.b` and `a.b()` whenever `a` resolves,
 * and when it does not the whole chain is unresolved either way — so optional
 * chains are read as their plain counterparts and every rule applies to both.
 */
function deoptional(e: t.Expression): t.Expression {
  if (e.type === "OptionalCallExpression") {
    return { ...e, type: "CallExpression", callee: deoptional(e.callee) } as unknown as t.CallExpression;
  }
  if (e.type === "OptionalMemberExpression") {
    return { ...e, type: "MemberExpression", object: deoptional(e.object) } as unknown as t.MemberExpression;
  }
  return e;
}

/** Resolve an identifier/member expression to its literal AST value, if it is static data. */
// Recursion guard. Real pages derive data several layers deep
// (Object.fromEntries → map → helper → glob table → ?.url), so the cap is
// generous; true cycles are cut by callStack/inlineStack instead.
const MAX_DEPTH = 40;

function resolveExpr(expr: t.Expression, ctx: Ctx, depth = 0): t.Expression | number | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const e = unwrap(expr);

  if (e.type === "Identifier") {
    for (let i = ctx.scopes.length - 1; i >= 0; i--) {
      if (ctx.scopes[i].has(e.name)) {
        // Component-body locals are stored unresolved (they may reference
        // props bound in the same scope), so resolve on the way out.
        const v = ctx.scopes[i].get(e.name);
        if (v === undefined || typeof v === "number") return v;
        return resolveExpr(v, ctx, depth + 1) ?? v;
      }
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
    if (ctx.assetImports.has(e.name)) return assetLiteral(e.name, ctx);
    return undefined;
  }

  if (e.type === "MemberExpression" || e.type === "OptionalMemberExpression") {
    const objRes = resolveExpr(e.object as t.Expression, ctx, depth + 1);
    if (typeof objRes === "number" || !objRes) return undefined;
    const obj = unwrap(objRes);
    let key: string | number | undefined;
    if (!e.computed && e.property.type === "Identifier") key = e.property.name;
    else if (e.property.type === "StringLiteral") key = e.property.value;
    else if (e.property.type === "NumericLiteral") key = e.property.value;
    else if (e.computed) {
      // A computed index that is itself static: CHAPTERS[index] with index from
      // useState(0), PHOTOS[person.name], items[i] inside an expanded map.
      const computed = staticValue(e.property, ctx, depth + 1);
      if (typeof computed === "string" || typeof computed === "number") key = computed;
    }
    if (key === undefined) return undefined;

    if (obj.type === "ObjectExpression") {
      for (const prop of objectProperties(obj, ctx, depth)) {
        if (propertyName(prop) === String(key)) {
          return resolveExpr(prop.value as t.Expression, ctx, depth + 1) ?? (prop.value as t.Expression);
        }
      }
      return undefined;
    }
    if (obj.type === "ArrayExpression" && typeof key === "number") {
      const el = flattenElements(obj, ctx, depth)[key];
      if (el) return resolveExpr(el, ctx, depth + 1) ?? el;
      return undefined;
    }
    if (obj.type === "StringLiteral" && key === "length") return obj.value.length;
    if (obj.type === "ArrayExpression" && key === "length") return flattenElements(obj, ctx, depth).length;
    return undefined;
  }

  if (e.type === "CallExpression") {
    const memo = memoCallbackResult(e, ctx, depth);
    if (memo !== undefined) return memo;
    const listed = objectListingResult(e, ctx, depth) ?? splitResult(e, ctx, depth);
    if (listed) return listed;
    const arr = arrayMethodResult(e, ctx, depth);
    if (arr) return arr;
    const obj = objectFromEntriesResult(e, ctx, depth);
    if (obj) return obj;
    const mapped = mapCallResult(e, ctx, depth);
    if (mapped) return mapped;
    const found = findCallResult(e, ctx, depth);
    if (found) return found;
    const called = helperCallResult(e, ctx, depth);
    if (called) return called;
  }

  // `active === "All" ? everyone : everyone.filter(...)` used as data: decide
  // the test statically when possible, otherwise take the first branch (the
  // same choice runtime conditionals in JSX get).
  if (e.type === "ConditionalExpression") {
    const test = staticValue(e.test as t.Expression, ctx, depth + 1);
    const branch = test === undefined || test ? e.consequent : e.alternate;
    return resolveExpr(branch, ctx, depth + 1) ?? branch;
  }

  // `PATHWAYS.find(...) ?? PATHWAYS[0]`, `props.items || DEFAULT_ITEMS`: pick
  // the side that resolves to data, the way the runtime would.
  if (e.type === "LogicalExpression") {
    // Primitive operands short-circuit on their value (`kind === "any" || ...`
    // is `true` when its left side is); object/array operands fall through to
    // the data rules below.
    const lv = staticValue(e.left as t.Expression, ctx, depth + 1);
    if (lv !== undefined) {
      const takeRight = e.operator === "||" ? !lv : e.operator === "&&" ? Boolean(lv) : lv === null;
      if (!takeRight) return primitiveLiteral(lv);
      return resolveExpr(e.right, ctx, depth + 1) ?? e.right;
    }
    const left = resolveExpr(e.left as t.Expression, ctx, depth + 1);
    const leftData = isDataNode(left);
    if (e.operator === "??") {
      if (leftData && !(typeof left !== "number" && unwrap(left).type === "NullLiteral")) return left;
      return resolveExpr(e.right, ctx, depth + 1);
    }
    if (e.operator === "||") {
      if (leftData && isTruthyData(left)) return left;
      return resolveExpr(e.right, ctx, depth + 1);
    }
    if (leftData) return isTruthyData(left) ? resolveExpr(e.right, ctx, depth + 1) : left;
    return undefined;
  }

  // `{ ...base, tone: "dark" }` — merge so property lookups see everything.
  if (e.type === "ObjectExpression" && e.properties.some((prop) => prop.type === "SpreadElement")) {
    return { type: "ObjectExpression", properties: objectProperties(e, ctx, depth) } as t.ObjectExpression;
  }

  return e;
}

/**
 * The static value of an imported asset: the hosted URL the bundler uploaded
 * (or, for a file it could not fetch, the placeholder image). A sidecar import
 * becomes `{ url }` so `logo.url` reads the same way it does at runtime.
 */
function assetLiteral(localName: string, ctx: Ctx): t.Expression {
  const cached = ctx.assetLiterals.get(localName);
  if (cached) return cached;
  const spec = ctx.assetImports.get(localName)!;
  let url = ctx.assetUrls.get(spec);
  if (!url) {
    const file = spec.split("/").pop();
    if (isImageSpecifier(spec)) {
      url = PLACEHOLDER_IMAGE;
      note(ctx, `Image "${file}" could not be fetched from the project — a placeholder was used; upload the real image in the editor.`);
    } else {
      url = "";
      note(ctx, `Media file "${file}" could not be fetched from the project — set its URL in the editor.`);
    }
  }
  const urlNode = { type: "StringLiteral", value: url } as t.StringLiteral;
  const literal: t.Expression = ASSET_SIDECAR_RE.test(spec)
    ? ({
        type: "ObjectExpression",
        properties: [{
          type: "ObjectProperty",
          key: { type: "Identifier", name: "url" },
          value: urlNode,
          computed: false,
          shorthand: false,
        }],
      } as t.ObjectExpression)
    : urlNode;
  ctx.assetLiterals.set(localName, literal);
  return literal;
}

function propertyName(prop: t.ObjectProperty): string | undefined {
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "StringLiteral") return prop.key.value;
  if (prop.key.type === "NumericLiteral") return String(prop.key.value);
  return undefined;
}

/** An object's own properties with `...spread` sources merged in; later wins. */
function objectProperties(obj: t.ObjectExpression, ctx: Ctx, depth: number): t.ObjectProperty[] {
  const out = new Map<string, t.ObjectProperty>();
  for (const prop of obj.properties) {
    if (prop.type === "SpreadElement") {
      if (depth > 8) continue;
      const res = resolveExpr(prop.argument, ctx, depth + 1);
      const inner = res && typeof res !== "number" ? unwrap(res) : undefined;
      if (inner?.type === "ObjectExpression") {
        for (const inherited of objectProperties(inner, ctx, depth + 1)) {
          const name = propertyName(inherited);
          if (name !== undefined) out.set(name, inherited);
        }
      }
      continue;
    }
    if (prop.type !== "ObjectProperty") continue;
    const name = propertyName(prop);
    if (name !== undefined) out.set(name, prop);
  }
  return [...out.values()];
}

/**
 * Resolve an expression into a SELF-CONTAINED literal tree. A value produced
 * inside a callback or a helper call outlives the scope that gave its
 * parameters meaning, so nested `p.name` references have to be substituted now
 * rather than left to resolve later against a scope that is already gone.
 */
function materialize(expr: t.Expression, ctx: Ctx, depth: number): t.Expression | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const res = resolveExpr(expr, ctx, depth);
  if (res === undefined) return undefined;
  if (typeof res === "number") return { type: "NumericLiteral", value: res } as t.NumericLiteral;
  const e = unwrap(res);

  if (e.type === "ObjectExpression") {
    const properties = objectProperties(e, ctx, depth).map((prop) => ({
      ...prop,
      value: materialize(prop.value as t.Expression, ctx, depth + 1) ?? prop.value,
    }));
    return { type: "ObjectExpression", properties } as t.ObjectExpression;
  }
  if (e.type === "ArrayExpression") {
    const elements = flattenElements(e, ctx, depth).map((el) =>
      el ? materialize(el, ctx, depth + 1) ?? el : null,
    );
    return { type: "ArrayExpression", elements } as t.ArrayExpression;
  }
  // A template literal, arithmetic or builtin call still refers to the
  // parameters of the scope that is about to be popped — freeze its value.
  if (e.type === "TemplateLiteral" || e.type === "BinaryExpression" || e.type === "CallExpression" ||
      e.type === "ConditionalExpression" || e.type === "LogicalExpression" || e.type === "UnaryExpression") {
    const v = staticValue(e, ctx, depth + 1);
    if (typeof v === "string") return { type: "StringLiteral", value: v } as t.StringLiteral;
    if (typeof v === "number") return { type: "NumericLiteral", value: v } as t.NumericLiteral;
    if (typeof v === "boolean") return { type: "BooleanLiteral", value: v } as t.BooleanLiteral;
    if (v === null) return { type: "NullLiteral" } as t.NullLiteral;
  }
  return e;
}

const MAX_MAPPED_ITEMS = 300;

/**
 * `RAW_CHAPTERS.map((c) => withSections(c))` — content arrays are routinely
 * derived rather than written out. Materialize the result, or every page
 * reading it renders empty.
 */
function mapCallResult(e: t.CallExpression, ctx: Ctx, depth: number): t.ArrayExpression | undefined {
  if (depth > MAX_DEPTH || !isMapCall(e)) return undefined;
  const fn = e.arguments[0];
  if (!fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) return undefined;
  const body = fn.body.type === "BlockStatement"
    ? fn.body.body.find((st): st is t.ReturnStatement => st.type === "ReturnStatement")?.argument
    : fn.body;
  if (!body) return undefined;
  const srcRes = resolveExpr(e.callee.object as t.Expression, ctx, depth + 1);
  const src = srcRes && typeof srcRes !== "number" ? unwrap(srcRes) : undefined;
  if (src?.type !== "ArrayExpression") return undefined;

  const items = flattenElements(src, ctx, depth);
  if (items.length > MAX_MAPPED_ITEMS) return undefined;
  const elements: Array<t.Expression | null> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) {
      elements.push(null);
      continue;
    }
    const scope: Scope = new Map();
    bindPattern(fn.params[0], item, propertyLookup(item, ctx), scope, ctx, () => entriesOf(item, ctx));
    if (fn.params[1]?.type === "Identifier") scope.set(fn.params[1].name, i);
    bindBodyLocals(fn, scope, ctx);
    ctx.scopes.push(scope);
    const value = materialize(body, ctx, depth + 1);
    ctx.scopes.pop();
    elements.push(value ?? null);
  }
  return { type: "ArrayExpression", elements } as t.ArrayExpression;
}

/** A data helper the content layer calls: `withSections(c)`, `photoFor(name)`. */
function helperCallResult(e: t.CallExpression, ctx: Ctx, depth: number): t.Expression | undefined {
  if (depth > MAX_DEPTH || e.callee.type !== "Identifier") return undefined;
  const name = e.callee.name;
  // A helper declared inside the component body lives in its scope, not in
  // the module-level function table.
  let fn = ctx.functions.get(name);
  if (!fn) {
    for (let i = ctx.scopes.length - 1; i >= 0 && !fn; i--) {
      const v = ctx.scopes[i].get(name);
      if (v !== undefined && typeof v !== "number") fn = asComponentFn(unwrap(v));
    }
  }
  if (!fn || ctx.callStack.includes(name) || ctx.callStack.length > 6) return undefined;
  if (!componentReturnExpr(fn)) return undefined;

  const scope: Scope = new Map();
  for (let i = 0; i < fn.params.length; i++) {
    const arg = e.arguments[i];
    if (!arg || arg.type === "SpreadElement" || arg.type === "ArgumentPlaceholder") continue;
    const value = resolveExpr(arg, ctx, depth + 1) ?? arg;
    const lookup = typeof value === "number" ? () => undefined : propertyLookup(value, ctx);
    bindPattern(fn.params[i], value, lookup, scope, ctx, () => entriesOf(value, ctx));
  }
  bindBodyLocals(fn, scope, ctx);
  ctx.scopes.push(scope);
  ctx.callStack.push(name);
  const chosen = selectReturn(fn, ctx, depth);
  const result =
    chosen === null
      ? ({ type: "NullLiteral" } as t.NullLiteral) // the helper returns nothing: falsy, not unknown
      : chosen
        ? materialize(chosen, ctx, depth + 1)
        : undefined;
  ctx.callStack.pop();
  ctx.scopes.pop();
  return result;
}

/**
 * The return statement a helper would reach. Guard clauses run in order —
 *   if (!org) return undefined;
 *   if (staticKey) return STATIC_LOGOS[staticKey];
 * — for as long as their tests are static; past the first unknown test the
 * helper's final return stands in. `null` means "returns undefined".
 */
function selectReturn(fn: ComponentFn, ctx: Ctx, depth: number): t.Expression | null | undefined {
  if (fn.body.type !== "BlockStatement") return fn.body;
  const isNothing = (arg: t.Expression | null | undefined) =>
    !arg || (arg.type === "Identifier" && arg.name === "undefined") || arg.type === "NullLiteral";

  for (const stmt of fn.body.body) {
    if (stmt.type === "ReturnStatement") return isNothing(stmt.argument) ? null : stmt.argument;
    if (stmt.type !== "IfStatement" || stmt.alternate) continue;
    const ret = stmt.consequent.type === "ReturnStatement"
      ? stmt.consequent
      : stmt.consequent.type === "BlockStatement" && stmt.consequent.body.length === 1 &&
          stmt.consequent.body[0].type === "ReturnStatement"
        ? stmt.consequent.body[0]
        : undefined;
    if (!ret) continue;
    const test = staticValue(stmt.test, ctx, depth + 1);
    if (test === undefined) break;
    if (test) return isNothing(ret.argument) ? null : ret.argument;
  }
  return componentReturnExpr(fn);
}

/**
 * Route/id lookup tables are derived rather than written out:
 *   const CHAPTERS_BY_ROUTE = Object.fromEntries(CHAPTERS.map((c) => [c.route, c]))
 * Rebuild the object literal so `CHAPTERS_BY_ROUTE["/campus"]` resolves to a
 * chapter — otherwise the page reading it renders completely empty.
 */
function objectFromEntriesResult(e: t.CallExpression, ctx: Ctx, depth: number): t.ObjectExpression | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const callee = e.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  if (callee.object.type !== "Identifier" || callee.object.name !== "Object") return undefined;
  if (callee.property.type !== "Identifier" || callee.property.name !== "fromEntries") return undefined;
  const arg = e.arguments[0];
  if (!arg || arg.type === "SpreadElement" || arg.type === "ArgumentPlaceholder") return undefined;

  const pairs = entryPairs(arg, ctx, depth);
  if (!pairs?.length) return undefined;
  const properties = pairs.map(([key, value]) => ({
    type: "ObjectProperty",
    key: { type: "StringLiteral", value: key },
    value,
    computed: false,
    shorthand: false,
  })) as t.ObjectProperty[];
  return { type: "ObjectExpression", properties } as t.ObjectExpression;
}

/** `[[k, v], ...]` written out, or produced by `ARR.map((x) => [k, v])`. */
function entryPairs(expr: t.Expression, ctx: Ctx, depth: number): Array<[string, t.Expression]> | undefined {
  const e = unwrap(expr);
  const out: Array<[string, t.Expression]> = [];

  const readPair = (pair: t.Node): void => {
    const p = unwrap(pair as t.Expression);
    if (p.type !== "ArrayExpression" || p.elements.length < 2) return;
    const [rawKey, rawValue] = p.elements;
    if (!rawKey || rawKey.type === "SpreadElement" || !rawValue || rawValue.type === "SpreadElement") return;
    const key = staticValue(rawKey, ctx, depth + 1);
    const value = resolveExpr(rawValue, ctx, depth + 1);
    if (typeof key !== "string" && typeof key !== "number") return;
    if (value === undefined || typeof value === "number") return;
    out.push([String(key), value]);
  };

  if (isMapCall(e)) {
    const srcRes = resolveExpr(e.callee.object as t.Expression, ctx, depth + 1);
    const src = srcRes && typeof srcRes !== "number" ? unwrap(srcRes) : undefined;
    const fn = e.arguments[0];
    if (src?.type !== "ArrayExpression") return undefined;
    if (!fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) return undefined;
    const body = fn.body.type === "BlockStatement"
      ? fn.body.body.find((st): st is t.ReturnStatement => st.type === "ReturnStatement")?.argument
      : fn.body;
    if (!body) return undefined;
    for (const item of flattenElements(src, ctx, depth)) {
      if (!item) continue;
      const scope: Scope = new Map();
      bindPattern(fn.params[0], item, propertyLookup(item, ctx), scope, ctx);
      ctx.scopes.push(scope);
      readPair(body);
      ctx.scopes.pop();
    }
    return out;
  }

  const resolved = resolveExpr(e, ctx, depth + 1);
  const arr = resolved && typeof resolved !== "number" ? unwrap(resolved) : undefined;
  if (arr?.type !== "ArrayExpression") return undefined;
  for (const item of flattenElements(arr, ctx, depth)) if (item) readPair(item);
  return out;
}

function isMapCall(e: t.Expression): e is t.CallExpression & { callee: t.MemberExpression } {
  return e.type === "CallExpression" && e.callee.type === "MemberExpression" && !e.callee.computed &&
    e.callee.property.type === "Identifier" && e.callee.property.name === "map";
}

/**
 * Array literals in page data are routinely assembled from other arrays —
 * `[{ v: pct, l: "of faculty" }, ...stats]`. Expand the spreads so a `.map()`
 * over the result renders every row, not just the ones written inline.
 */
function flattenElements(arr: t.ArrayExpression, ctx: Ctx, depth = 0): Array<t.Expression | null> {
  const out: Array<t.Expression | null> = [];
  for (const el of arr.elements) {
    if (!el) {
      out.push(null);
    } else if (el.type !== "SpreadElement") {
      out.push(el);
    } else if (depth < 4) {
      const res = resolveExpr(el.argument, ctx);
      const inner = res && typeof res !== "number" ? unwrap(res) : undefined;
      if (inner?.type === "ArrayExpression") out.push(...flattenElements(inner, ctx, depth + 1));
    }
  }
  return out;
}

/** `Object.entries(table)`, `Object.keys(table)`, `Object.values(table)` over a literal object. */
function objectListingResult(e: t.CallExpression, ctx: Ctx, depth: number): t.ArrayExpression | undefined {
  const callee = e.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  if (callee.object.type !== "Identifier" || callee.object.name !== "Object") return undefined;
  if (callee.property.type !== "Identifier") return undefined;
  const method = callee.property.name;
  if (method !== "entries" && method !== "keys" && method !== "values") return undefined;
  const arg = e.arguments[0];
  if (!arg || arg.type === "SpreadElement" || arg.type === "ArgumentPlaceholder") return undefined;
  const res = resolveExpr(arg, ctx, depth + 1);
  const obj = res && typeof res !== "number" ? unwrap(res) : undefined;
  if (obj?.type !== "ObjectExpression") return undefined;
  const elements: t.Expression[] = [];
  for (const prop of objectProperties(obj, ctx, depth)) {
    const name = propertyName(prop);
    if (name === undefined) continue;
    const key = { type: "StringLiteral", value: name } as t.StringLiteral;
    const value = prop.value as t.Expression;
    if (method === "keys") elements.push(key);
    else if (method === "values") elements.push(value);
    else elements.push({ type: "ArrayExpression", elements: [key, value] } as t.ArrayExpression);
  }
  return { type: "ArrayExpression", elements } as t.ArrayExpression;
}

/** `path.split("/")` on a static string, as an array literal. */
function splitResult(e: t.CallExpression, ctx: Ctx, depth: number): t.ArrayExpression | undefined {
  const callee = e.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  if (callee.property.type !== "Identifier" || callee.property.name !== "split") return undefined;
  const target = staticValue(callee.object as t.Expression, ctx, depth + 1);
  if (typeof target !== "string") return undefined;
  const arg = e.arguments[0];
  if (!arg || arg.type === "SpreadElement" || arg.type === "ArgumentPlaceholder") return undefined;
  const sep = staticValue(arg, ctx, depth + 1);
  if (typeof sep !== "string") return undefined;
  const elements = target.split(sep).map((part) => ({ type: "StringLiteral", value: part }) as t.StringLiteral);
  return { type: "ArrayExpression", elements } as t.ArrayExpression;
}

/**
 * `useMemo(() => PARTNERS.filter(...), [deps])` is just its callback's value
 * once there is no re-rendering to memoize across.
 */
function memoCallbackResult(e: t.CallExpression, ctx: Ctx, depth: number): t.Expression | number | undefined {
  const callee = e.callee;
  const isMemo =
    (callee.type === "Identifier" && callee.name === "useMemo") ||
    (callee.type === "MemberExpression" && !callee.computed &&
      callee.property.type === "Identifier" && callee.property.name === "useMemo");
  if (!isMemo || depth > MAX_DEPTH) return undefined;
  const fn = e.arguments[0];
  if (!fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) return undefined;
  const body = componentReturnExpr(fn);
  if (!body) return undefined;
  const scope: Scope = new Map();
  bindBodyLocals(fn, scope, ctx);
  ctx.scopes.push(scope);
  const result = materialize(body, ctx, depth + 1) ?? resolveExpr(body, ctx, depth + 1);
  ctx.scopes.pop();
  return result;
}

/** A resolved node that stands for a concrete value rather than unresolved code. */
function isDataNode(res: t.Expression | number | undefined): res is t.Expression | number {
  if (res === undefined) return false;
  if (typeof res === "number") return true;
  switch (unwrap(res).type) {
    case "StringLiteral": case "NumericLiteral": case "BooleanLiteral": case "NullLiteral":
    case "TemplateLiteral": case "ObjectExpression": case "ArrayExpression":
    case "JSXElement": case "JSXFragment":
      return true;
    default:
      return false;
  }
}

function isTruthyData(res: t.Expression | number): boolean {
  if (typeof res === "number") return res !== 0;
  const e = unwrap(res);
  switch (e.type) {
    case "StringLiteral": return e.value !== "";
    case "NumericLiteral": return e.value !== 0;
    case "BooleanLiteral": return e.value;
    case "NullLiteral": return false;
    default: return true;
  }
}

/**
 * `ITEMS.find((p) => p.key === activeKey)` — the predicate is evaluated
 * statically per element (state initialisers make `activeKey` resolvable). If
 * it can't be evaluated at all, the first element stands in, matching how
 * runtime conditionals elsewhere resolve to their first branch. `.at(i)` and
 * `.findLast` are handled the same way.
 */
function findCallResult(e: t.CallExpression, ctx: Ctx, depth: number): t.Expression | number | undefined {
  if (depth > MAX_DEPTH || e.callee.type !== "MemberExpression" || e.callee.computed) return undefined;
  if (e.callee.property.type !== "Identifier") return undefined;
  const method = e.callee.property.name;
  if (!["find", "findLast", "at", "pop", "shift"].includes(method)) return undefined;
  const srcRes = resolveExpr(e.callee.object as t.Expression, ctx, depth + 1);
  const src = srcRes && typeof srcRes !== "number" ? unwrap(srcRes) : undefined;
  if (src?.type !== "ArrayExpression") return undefined;
  const items = flattenElements(src, ctx, depth).filter((el): el is t.Expression => el !== null);
  if (items.length === 0) return undefined;

  if (method === "pop" || method === "shift") {
    const el = method === "pop" ? items[items.length - 1] : items[0];
    return resolveExpr(el, ctx, depth + 1) ?? el;
  }

  if (method === "at") {
    const a = e.arguments[0];
    const i = a && a.type !== "SpreadElement" && a.type !== "ArgumentPlaceholder" ? staticValue(a, ctx, depth + 1) : undefined;
    if (typeof i !== "number") return undefined;
    const el = items[i < 0 ? items.length + i : i];
    return el ? resolveExpr(el, ctx, depth + 1) ?? el : undefined;
  }

  const fn = e.arguments[0];
  const ordered = method === "findLast" ? [...items].reverse() : items;
  if (!fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) return undefined;
  const body = fn.body.type === "BlockStatement"
    ? fn.body.body.find((st): st is t.ReturnStatement => st.type === "ReturnStatement")?.argument
    : fn.body;
  let undecided = false;
  if (body) {
    for (let i = 0; i < ordered.length; i++) {
      const item = ordered[i];
      const scope: Scope = new Map();
      bindPattern(fn.params[0], item, propertyLookup(item, ctx), scope, ctx, () => entriesOf(item, ctx));
      if (fn.params[1]?.type === "Identifier") scope.set(fn.params[1].name, i);
      ctx.scopes.push(scope);
      const verdict = staticValue(body, ctx, depth + 1);
      ctx.scopes.pop();
      if (verdict === undefined) { undecided = true; break; }
      if (verdict) return resolveExpr(item, ctx, depth + 1) ?? item;
    }
    // The predicate statically rejected every element: the runtime value is
    // `undefined`, which is knowledge (falsy), not an unresolved expression.
    if (!undecided) return { type: "NullLiteral" } as t.NullLiteral;
  }
  note(ctx, "A .find() whose test depends on runtime state resolved to the first item.");
  return resolveExpr(ordered[0], ctx, depth + 1) ?? ordered[0];
}

/**
 * Content arrays are rarely used raw: `EPISODES.slice(0, 3)`, `FACULTY.filter(...)`,
 * `[...LOGOS].reverse()`. Resolve those back to an array literal so the `.map()`
 * that follows can still be expanded — the alternative is dropping the whole
 * list. Predicates and comparators can't run statically, so `filter` and `sort`
 * keep every element; a preview showing all the rows beats one showing none.
 */
function arrayMethodResult(e: t.CallExpression, ctx: Ctx, depth: number): t.ArrayExpression | undefined {
  if (e.callee.type !== "MemberExpression" || e.callee.computed) return undefined;
  if (e.callee.property.type !== "Identifier") return undefined;
  const method = e.callee.property.name;
  if (!["slice", "filter", "sort", "toSorted", "reverse", "toReversed", "concat", "flat"].includes(method)) {
    return undefined;
  }
  const objRes = resolveExpr(e.callee.object as t.Expression, ctx, depth + 1);
  if (!objRes || typeof objRes === "number") return undefined;
  const obj = unwrap(objRes);
  if (obj.type !== "ArrayExpression") return undefined;

  let elements: Array<t.Expression | t.SpreadElement | null> = flattenElements(obj, ctx, depth);
  if (method === "filter") {
    // Run the predicate per element when it is static for every one of them
    // (`f.category === active` with state, `Boolean(f.img)`); otherwise keep
    // everything rather than guess.
    const verdicts = filterVerdicts(e, elements, ctx, depth);
    if (verdicts) elements = elements.filter((_, i) => verdicts[i]);
  }
  if (method === "reverse" || method === "toReversed") elements.reverse();
  if (method === "concat") {
    for (const arg of e.arguments) {
      if (arg.type === "SpreadElement") continue;
      const res = resolveExpr(arg as t.Expression, ctx, depth + 1);
      const other = res && typeof res !== "number" ? unwrap(res) : undefined;
      if (other?.type === "ArrayExpression") elements.push(...other.elements);
      else elements.push(arg as t.Expression);
    }
  }
  if (method === "slice") {
    const at = (i: number) => {
      const a = e.arguments[i];
      if (!a || a.type === "SpreadElement") return undefined;
      const v = staticValue(a as t.Expression, ctx, depth + 1);
      return typeof v === "number" ? v : undefined;
    };
    const start = at(0);
    const end = at(1);
    if (start === undefined && e.arguments.length > 0) return undefined;
    return { type: "ArrayExpression", elements: elements.slice(start ?? 0, end) } as t.ArrayExpression;
  }
  return { type: "ArrayExpression", elements } as t.ArrayExpression;
}

function filterVerdicts(
  e: t.CallExpression,
  elements: Array<t.Expression | t.SpreadElement | null>,
  ctx: Ctx,
  depth: number,
): boolean[] | undefined {
  const fn = e.arguments[0];
  if (fn?.type === "Identifier" && fn.name === "Boolean") {
    // `[a, b].filter(Boolean)` — drop what is statically falsy.
    const verdicts: boolean[] = [];
    for (const item of elements) {
      if (!item || item.type === "SpreadElement") return undefined;
      const v = staticValue(item, ctx, depth + 1);
      verdicts.push(v === undefined ? true : Boolean(v));
    }
    return verdicts;
  }
  if (!fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) return undefined;
  const body = componentReturnExpr(fn);
  if (!body) return undefined;
  const out: boolean[] = [];
  for (let i = 0; i < elements.length; i++) {
    const item = elements[i];
    if (!item || item.type === "SpreadElement") return undefined;
    const scope: Scope = new Map();
    bindPattern(fn.params[0], item, propertyLookup(item, ctx), scope, ctx, () => entriesOf(item, ctx));
    if (fn.params[1]?.type === "Identifier") scope.set(fn.params[1].name, i);
    bindBodyLocals(fn, scope, ctx);
    ctx.scopes.push(scope);
    const verdict = staticValue(body, ctx, depth + 1);
    ctx.scopes.pop();
    if (verdict === undefined) return undefined;
    out.push(Boolean(verdict));
  }
  return out;
}

/** Literal JS value of a static expression (strings, numbers, booleans, null). */
function staticValue(expr: t.Expression, ctx: Ctx, depth = 0): string | number | boolean | null | undefined {
  if (depth > MAX_DEPTH) return undefined;
  // `f.img` on a literal that has no `img`: definitely absent, so falsy —
  // `{f.img ? <img/> : <Initials/>}` must take the second branch.
  if (memberDefinitelyMissing(expr, ctx, depth)) return null;
  if (isImportMetaEnv(unwrap(expr))) return null;
  {
    // Boolean logic has to short-circuit on *values*: `kind === "any" || p.kind === kind`
    // is true when the left side is, whatever the right side says.
    const raw = unwrap(expr);
    if (raw.type === "LogicalExpression") {
      const l = staticValue(raw.left as t.Expression, ctx, depth + 1);
      if (l !== undefined) {
        if (raw.operator === "||") return l ? l : staticValue(raw.right, ctx, depth + 1);
        if (raw.operator === "&&") return l ? staticValue(raw.right, ctx, depth + 1) : l;
        return l === null ? staticValue(raw.right, ctx, depth + 1) : l;
      }
    }
    const size = setSize(raw, ctx, depth);
    if (size !== undefined) return size;
  }
  const resolved = resolveExpr(expr, ctx, depth);
  if (typeof resolved === "number") return resolved;
  if (!resolved) return undefined;
  const e = unwrap(resolved);
  if (isImportMetaEnv(e)) return null;

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
        case "-": return Number(l) - Number(r);
        case "*": return Number(l) * Number(r);
        case "/": return Number(r) === 0 ? undefined : Number(l) / Number(r);
        case "%": return Number(r) === 0 ? undefined : Number(l) % Number(r);
        case ">": return (l as number) > (r as number);
        case "<": return (l as number) < (r as number);
        case ">=": return (l as number) >= (r as number);
        case "<=": return (l as number) <= (r as number);
        case "===": case "==": return l === r;
        case "!==": case "!=": return l !== r;
        default: return undefined;
      }
    }
    case "ConditionalExpression": {
      const test = staticValue(e.test as t.Expression, ctx, depth + 1);
      if (test === undefined) return undefined;
      return staticValue(test ? e.consequent : e.alternate, ctx, depth + 1);
    }
    case "CallExpression": return staticCallValue(e, ctx, depth);
    default: return undefined;
  }
}

/**
 * Text assembled with the handful of builtins content code actually uses:
 * `String(i + 1).padStart(2, "0")` for chapter counters, `.toUpperCase()` for
 * eyebrows, `.slice()` for excerpts. Anything else stays unresolved.
 */
/**
 * `import.meta.env.VITE_SOMETHING`: build-time environment of the Lovable
 * project. It does not exist here, and must never be guessed — treat it as
 * unset so `if (!TOKEN) return undefined` guards take their safe branch.
 */
function isImportMetaEnv(e: t.Expression): boolean {
  if (e.type !== "MemberExpression" && e.type !== "OptionalMemberExpression") return false;
  const obj = unwrap(e.object as t.Expression);
  if (obj.type !== "MemberExpression" || obj.computed) return false;
  return obj.object.type === "MetaProperty" && obj.property.type === "Identifier" && obj.property.name === "env";
}

/** `new Set(PARTNERS.map((p) => p.country)).size` — the count of distinct static values. */
function setSize(e: t.Expression, ctx: Ctx, depth: number): number | undefined {
  if (e.type !== "MemberExpression" || e.computed) return undefined;
  if (e.property.type !== "Identifier" || e.property.name !== "size") return undefined;
  const objRes = resolveExpr(e.object as t.Expression, ctx, depth + 1);
  const obj = objRes && typeof objRes !== "number" ? unwrap(objRes) : undefined;
  if (obj?.type !== "NewExpression" || obj.callee.type !== "Identifier" || obj.callee.name !== "Set") return undefined;
  const arg = obj.arguments[0];
  if (!arg) return 0;
  if (arg.type === "SpreadElement" || arg.type === "ArgumentPlaceholder") return undefined;
  const arrRes = resolveExpr(arg, ctx, depth + 1);
  const arr = arrRes && typeof arrRes !== "number" ? unwrap(arrRes) : undefined;
  if (arr?.type !== "ArrayExpression") return undefined;
  const seen = new Set<unknown>();
  for (const el of flattenElements(arr, ctx, depth)) {
    if (!el) continue;
    const v = staticValue(el, ctx, depth + 1);
    if (v === undefined) return undefined;
    seen.add(v);
  }
  return seen.size;
}

/** True when `a.b` names a property that a fully resolved object literal simply does not have. */
function memberDefinitelyMissing(expr: t.Expression, ctx: Ctx, depth: number): boolean {
  const e = unwrap(expr);
  if (e.type !== "MemberExpression" && e.type !== "OptionalMemberExpression") return false;
  let name: string;
  if (!e.computed) {
    if (e.property.type !== "Identifier") return false;
    name = e.property.name;
  } else {
    // `LOGOS[n]` with a static `n` that the table does not list.
    const key = staticValue(e.property as t.Expression, ctx, depth + 1);
    if (typeof key !== "string" && typeof key !== "number") return false;
    name = String(key);
  }
  const objRes = resolveExpr(e.object as t.Expression, ctx, depth + 1);
  if (!objRes || typeof objRes === "number") return false;
  const obj = unwrap(objRes);
  if (obj.type !== "ObjectExpression") return false;
  // A spread we could not expand might supply the key, so stay undecided.
  if (obj.properties.some((prop) => prop.type === "SpreadElement")) return false;
  return !objectProperties(obj, ctx, depth + 1).some((prop) => propertyName(prop) === name);
}

function staticCallValue(e: t.CallExpression, ctx: Ctx, depth: number): string | number | boolean | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const argAt = (i: number) => {
    const a = e.arguments[i];
    if (!a || a.type === "SpreadElement" || a.type === "ArgumentPlaceholder") return undefined;
    return staticValue(a, ctx, depth + 1);
  };

  if (e.callee.type === "Identifier") {
    const value = argAt(0);
    if (e.callee.name === "Boolean") return value === undefined ? undefined : Boolean(value);
    if (value === undefined || value === null) return undefined;
    if (e.callee.name === "String") return String(value);
    if (e.callee.name === "Number") return Number(value);
    return undefined;
  }

  if (e.callee.type !== "MemberExpression" || e.callee.computed) return undefined;
  if (e.callee.property.type !== "Identifier") return undefined;
  const method = e.callee.property.name;

  if (e.callee.object.type === "Identifier" && e.callee.object.name === "Math") {
    const nums = e.arguments.map((_, i) => argAt(i));
    if (nums.some((n) => typeof n !== "number")) return undefined;
    const ns = nums as number[];
    switch (method) {
      case "min": return Math.min(...ns);
      case "max": return Math.max(...ns);
      case "floor": return Math.floor(ns[0]);
      case "ceil": return Math.ceil(ns[0]);
      case "round": return Math.round(ns[0]);
      case "abs": return Math.abs(ns[0]);
      case "trunc": return Math.trunc(ns[0]);
      default: return undefined;
    }
  }

  if (method === "reduce" || method === "join" || method === "includes" || method === "some" || method === "every") {
    const viaArray = arrayBuiltin(e, method, ctx, depth);
    if (viaArray !== undefined) return viaArray;
  }

  const target = staticValue(e.callee.object as t.Expression, ctx, depth + 1);

  if (typeof target === "string") {
    const n = argAt(0);
    switch (method) {
      case "replace":
      case "replaceAll": {
        const replacement = argAt(1);
        if (typeof replacement !== "string") return undefined;
        const pattern = e.arguments[0];
        if (pattern?.type === "RegExpLiteral") {
          // A literal pattern from the page source, applied to a literal string.
          try {
            return target.replace(new RegExp(pattern.pattern, pattern.flags), replacement);
          } catch {
            return undefined;
          }
        }
        if (typeof n !== "string") return undefined;
        return method === "replaceAll" ? target.split(n).join(replacement) : target.replace(n, replacement);
      }
      case "includes": return typeof n === "string" ? target.includes(n) : undefined;
      case "startsWith": return typeof n === "string" ? target.startsWith(n) : undefined;
      case "endsWith": return typeof n === "string" ? target.endsWith(n) : undefined;
      case "toUpperCase": return target.toUpperCase();
      case "toLowerCase": return target.toLowerCase();
      case "trim": return target.trim();
      case "padStart":
      case "padEnd": {
        if (typeof n !== "number") return undefined;
        const pad = argAt(1);
        const fill = typeof pad === "string" ? pad : " ";
        return method === "padStart" ? target.padStart(n, fill) : target.padEnd(n, fill);
      }
      case "slice": {
        const end = argAt(1);
        return target.slice(
          typeof n === "number" ? n : 0,
          typeof end === "number" ? end : undefined,
        );
      }
      default: return undefined;
    }
  }

  if (typeof target === "number") {
    const digits = argAt(0);
    if (method === "toString") return String(target);
    if (method === "toFixed" && typeof digits === "number") return target.toFixed(digits);
    return undefined;
  }

  return undefined;
}

function primitiveLiteral(v: string | number | boolean | null): t.Expression {
  if (typeof v === "string") return { type: "StringLiteral", value: v } as t.StringLiteral;
  if (typeof v === "number") return { type: "NumericLiteral", value: v } as t.NumericLiteral;
  if (typeof v === "boolean") return { type: "BooleanLiteral", value: v } as t.BooleanLiteral;
  return { type: "NullLiteral" } as t.NullLiteral;
}

/** Array builtins whose result is a primitive: reduce (sums, counts), join, includes, some, every. */
function arrayBuiltin(
  e: t.CallExpression, method: string, ctx: Ctx, depth: number,
): string | number | boolean | undefined {
  if (e.callee.type !== "MemberExpression") return undefined;
  const srcRes = resolveExpr(e.callee.object as t.Expression, ctx, depth + 1);
  const src = srcRes && typeof srcRes !== "number" ? unwrap(srcRes) : undefined;
  if (src?.type !== "ArrayExpression") return undefined;
  const items = flattenElements(src, ctx, depth).filter((el): el is t.Expression => el !== null);
  const arg = (i: number) => {
    const a = e.arguments[i];
    return a && a.type !== "SpreadElement" && a.type !== "ArgumentPlaceholder" ? a : undefined;
  };

  if (method === "join") {
    const sepArg = arg(0);
    const sep = sepArg ? staticValue(sepArg, ctx, depth + 1) : ",";
    if (typeof sep !== "string") return undefined;
    const parts: string[] = [];
    for (const item of items) {
      const v = staticValue(item, ctx, depth + 1);
      if (v === undefined) return undefined;
      parts.push(v === null ? "" : String(v));
    }
    return parts.join(sep);
  }

  if (method === "includes") {
    const needleArg = arg(0);
    const needle = needleArg ? staticValue(needleArg, ctx, depth + 1) : undefined;
    if (needle === undefined) return undefined;
    let unknown = false;
    for (const item of items) {
      const v = staticValue(item, ctx, depth + 1);
      if (v === undefined) unknown = true;
      else if (v === needle) return true;
    }
    return unknown ? undefined : false;
  }

  const fn = arg(0);
  if (!fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) return undefined;
  const body = componentReturnExpr(fn);
  if (!body) return undefined;

  if (method === "reduce") {
    const initArg = arg(1);
    let acc = initArg ? staticValue(initArg, ctx, depth + 1) : undefined;
    if (acc === undefined) return undefined;
    for (let i = 0; i < items.length; i++) {
      const scope: Scope = new Map();
      if (fn.params[0]?.type === "Identifier") scope.set(fn.params[0].name, primitiveLiteral(acc));
      bindPattern(fn.params[1], items[i], propertyLookup(items[i], ctx), scope, ctx, () => entriesOf(items[i], ctx));
      if (fn.params[2]?.type === "Identifier") scope.set(fn.params[2].name, i);
      bindBodyLocals(fn, scope, ctx);
      ctx.scopes.push(scope);
      acc = staticValue(body, ctx, depth + 1);
      ctx.scopes.pop();
      if (acc === undefined) return undefined;
    }
    return acc === null ? undefined : acc;
  }

  // some / every
  let unknown = false;
  for (let i = 0; i < items.length; i++) {
    const scope: Scope = new Map();
    bindPattern(fn.params[0], items[i], propertyLookup(items[i], ctx), scope, ctx, () => entriesOf(items[i], ctx));
    if (fn.params[1]?.type === "Identifier") scope.set(fn.params[1].name, i);
    bindBodyLocals(fn, scope, ctx);
    ctx.scopes.push(scope);
    const v = staticValue(body, ctx, depth + 1);
    ctx.scopes.pop();
    if (v === undefined) unknown = true;
    else if (method === "some" && v) return true;
    else if (method === "every" && !v) return false;
  }
  if (unknown) return undefined;
  return method === "every";
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
      } else if (inner.type === "BinaryExpression" && inner.operator === "+") {
        push(inner.left as t.Expression);
        push(inner.right);
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
  // Positional slugs ("section-3") would put a page's *position* into every
  // field key below it, so inserting one section upstream renames every key
  // after it and orphans the admin's edits on the next sync. Named sections
  // are stable and stay in the key; positional ones are dropped from it.
  const slug = /^section-\d+$/.test(ctx.section) ? "page" : ctx.section;
  const base = `${slug}-${tag}-${hash4(content)}`;
  let key = base;
  let i = 2;
  while (ctx.usedKeys.has(key)) key = `${base}-${i++}`;
  ctx.usedKeys.add(key);
  return key;
}

function fieldLabel(type: FieldType, defaultValue: string): string {
  const fileName = () => defaultValue.split("/").pop()?.split("?")[0].slice(0, 60);
  switch (type) {
    case "IMAGE":
      if (defaultValue.startsWith("data:")) return "Image (placeholder)";
      return fileName() || "Image";
    case "VIDEO":
      return fileName() || "Video";
    case "LINK":
      return defaultValue.length > 60 ? defaultValue.slice(0, 57) + "..." : defaultValue || "Link";
    default:
      return defaultValue.length > 60 ? defaultValue.slice(0, 57) + "..." : defaultValue;
  }
}

function addField(ctx: Ctx, type: FieldType, tag: string, defaultValue: string): string {
  const key = makeKey(ctx, tag, defaultValue);
  ctx.fields.push({
    key, type, defaultValue, label: fieldLabel(type, defaultValue), section: ctx.section, sortOrder: ctx.sort.n++,
  });
  switch (type) {
    case "TEXT": ctx.report.textFields++; break;
    case "IMAGE": ctx.report.imageFields++; break;
    case "LINK": ctx.report.linkFields = (ctx.report.linkFields ?? 0) + 1; break;
    case "VIDEO": ctx.report.videoFields = (ctx.report.videoFields ?? 0) + 1; break;
  }
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

/**
 * `<img {...rest} />` — splice a spread's properties in as if they had been
 * written out. Wrapper components forward their props this way constantly, and
 * dropping the spread strips the element's src, className and everything else,
 * leaving an invisible or unstyled node on the page.
 *
 * Order is preserved so a later attribute still overrides an earlier one, the
 * same way React resolves duplicate props.
 */
function expandSpreadAttributes(
  attrs: Array<t.JSXAttribute | t.JSXSpreadAttribute>,
  ctx: Ctx,
): t.JSXAttribute[] {
  const out: t.JSXAttribute[] = [];
  for (const attr of attrs) {
    if (attr.type === "JSXAttribute") {
      out.push(attr);
      continue;
    }
    const pairs = entriesOf(attr.argument, ctx);
    if (pairs.length === 0) {
      dropped(ctx, attr);
      continue;
    }
    for (const [name, value] of pairs) {
      if (!/^[A-Za-z_$][\w$:-]*$/.test(name)) continue;
      out.push({
        type: "JSXAttribute",
        name: { type: "JSXIdentifier", name },
        value: { type: "JSXExpressionContainer", expression: literalFor(value) },
      } as t.JSXAttribute);
    }
  }
  return out;
}

async function convertAttributes(
  attrs: Array<t.JSXAttribute | t.JSXSpreadAttribute>,
  tag: string,
  ctx: Ctx,
  inSvg: boolean,
  parentTag = "div",
): Promise<ConvertedProps> {
  const props: Record<string, PropValue> = {};
  let srcFieldKey: string | undefined;
  let hasSrcField = false;

  for (const attr of expandSpreadAttributes(attrs, ctx)) {
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

    // <source> is an image inside <picture> and a video inside <video>/<audio>.
    const mediaParent = parentTag === "video" || parentTag === "audio";
    const isImageSrc = (name === "src" && (tag === "img" || tag === "image" || (tag === "source" && !mediaParent))) ||
      (name === "poster" && tag === "video");
    const isVideoSrc = name === "src" && (tag === "video" || tag === "audio" || (tag === "source" && mediaParent));

    if (isImageSrc || isVideoSrc) {
      const v = staticValue(valueExpr, ctx);
      let url: string;
      if (typeof v === "string" && v.length > 0) {
        url = sanitizeUrl(v);
        if (url.startsWith("/") && !url.startsWith("/uploads/")) {
          note(ctx, `Media path "${url}" points at a Lovable project asset — replace it via the editor.`);
        }
      } else if (typeof v === "string") {
        // An asset the bundler could not fetch resolves to "" (already noted).
        url = isImageSrc ? PLACEHOLDER_IMAGE : "";
      } else {
        // Truly dynamic (state, props we could not bind): keep the slot editable.
        const what = isImageSrc ? "Image" : "Video";
        const fix = isImageSrc ? "a placeholder was used; upload the real image" : "set its URL";
        note(ctx, `${what} source "${snippet(ctx, valueExpr)}" could not be resolved — ${fix} in the editor.`);
        url = isImageSrc ? PLACEHOLDER_IMAGE : "";
      }
      const key = addField(ctx, isImageSrc ? "IMAGE" : "VIDEO", tag, url);
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

    if (name === "href" || name === "to") {
      const v = staticValue(valueExpr, ctx);
      if (typeof v === "string" && v.trim() && tag !== "link" && tag !== "base") {
        // Every link target is content an admin may need to change (a new
        // brochure, a moved form), so it becomes a field the way text does.
        const key = addField(ctx, "LINK", tag, sanitizeUrl(v.trim()));
        props.href = { $f: key } satisfies FieldRef;
      } else if (typeof v === "string") props.href = sanitizeUrl(v);
      else dropped(ctx, valueExpr);
      continue;
    }

    if (name === "action" || name === "src") {
      const v = staticValue(valueExpr, ctx);
      if (typeof v === "string") props[name] = sanitizeUrl(v);
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
  // Controlled inputs have no handler left to control them; React would render
  // them read-only and warn. Their value becomes the initial value instead.
  if (tag === "input" || tag === "select" || tag === "textarea") {
    if ("value" in props && !("defaultValue" in props)) {
      props.defaultValue = props.value;
      delete props.value;
    }
    if ("checked" in props && !("defaultChecked" in props)) {
      props.defaultChecked = props.checked;
      delete props.checked;
    }
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
  /** Each element child is its own editor section (the parent is a section wrapper). */
  sectioned = false,
): Promise<TreeNode[]> {
  const out: TreeNode[] = [];
  const outerSection = ctx.section;
  let index = 0;
  for (const child of children) {
    if (sectioned && child.type === "JSXElement") {
      if (isSectionWrapper(child, ctx)) ctx.sectionWrappers.add(child);
      else {
        ctx.sectionRoots.add(child);
        ctx.section = sectionSlugFor(child, index++, ctx);
      }
    }
    out.push(...(await convertNode(child, ctx, parentTag, inSvg)));
    if (sectioned) ctx.section = outerSection;
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
      return convertElement(node, ctx, inSvg, parentTag);

    case "JSXFragment":
      return convertChildren(node.children, ctx, parentTag, inSvg, ctx.sectionWrappers.has(node));

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

  // A prop holding markup: title={<>Faculty <Accent>who ship</Accent></>},
  // icon={<Star />}. The identifier resolves to JSX rather than to a value.
  if (e.type === "Identifier" || e.type === "MemberExpression") {
    const res = resolveExpr(e, ctx);
    if (res !== undefined && typeof res !== "number") {
      const r = unwrap(res);
      if (r.type === "JSXElement" || r.type === "JSXFragment") return convertNode(r, ctx, parentTag, inSvg);
    }
  }

  // {children} / {props.children} inside a component being inlined: emit the
  // JSX the caller passed in. Converted in the caller's scope, so its own
  // consts and map variables resolved before we got here.
  if (ctx.childrenStack.length > 0 && isChildrenRef(e)) {
    const frame = ctx.childrenStack[ctx.childrenStack.length - 1];
    frame.used = true;
    return frame.nodes;
  }

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
      const indexParam = fn.params[1]?.type === "Identifier" ? fn.params[1].name : undefined;
      let body: t.Expression | undefined;
      if (fn.body.type !== "BlockStatement") body = fn.body;
      else {
        const ret = fn.body.body.find((s): s is t.ReturnStatement => s.type === "ReturnStatement");
        if (ret?.argument) body = ret.argument;
      }
      if (body) {
        const results: TreeNode[] = [];
        const elements = flattenElements(arr, ctx);
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          if (!el) continue;
          const scope: Scope = new Map();
          // `(item)` and `({ id, icon: Icon })` are both common in Lovable code.
          const item = el;
          bindPattern(fn.params[0], item, propertyLookup(item, ctx), scope, ctx, () => entriesOf(item, ctx));
          if (indexParam) scope.set(indexParam, i);
          // `{logos.map((l) => { const name = l.file.replace(...); return <img alt={name} /> })}`
          bindBodyLocals(fn, scope, ctx);
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

/** The key a destructuring property reads, e.g. `icon: Icon` → "icon". */
function patternKey(prop: t.ObjectProperty): string | undefined {
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "StringLiteral") return prop.key.value;
  return undefined;
}

/**
 * Bind a function parameter to a value, following destructuring:
 *   (item)                    → item = value
 *   ({ id, icon: Icon })      → id = value.id, Icon = value.icon
 *   ({ label = "More" })      → label = value.label, or its default
 * `lookup` reads a property off the value; it resolves in the *outer* scope,
 * before this binding is pushed.
 */
function bindPattern(
  param: t.Node | undefined,
  value: t.Expression | number | undefined,
  lookup: (key: string) => t.Expression | number | undefined,
  scope: Scope,
  ctx: Ctx,
  entries?: () => Array<[string, t.Expression | number]>,
): void {
  if (!param) return;
  if (param.type === "Identifier") {
    if (value !== undefined) scope.set(param.name, value);
    return;
  }
  if (param.type === "ArrayPattern") {
    // `Object.entries(table).map(([path, mod]) => ...)`
    if (value === undefined || typeof value === "number") return;
    const res = resolveExpr(value, ctx);
    const arr = res && typeof res !== "number" ? unwrap(res) : undefined;
    if (arr?.type !== "ArrayExpression") return;
    const items = flattenElements(arr, ctx);
    param.elements.forEach((el, i) => {
      const item = items[i];
      if (!el || !item) return;
      if (el.type === "Identifier") scope.set(el.name, item);
      else bindPattern(el, item, propertyLookup(item, ctx), scope, ctx, () => entriesOf(item, ctx));
    });
    return;
  }
  if (param.type !== "ObjectPattern") return;
  const taken = new Set<string>();
  for (const prop of param.properties) {
    if (prop.type !== "ObjectProperty") continue;
    const key = patternKey(prop);
    if (!key) continue;
    taken.add(key);
    let local: t.Node = prop.value;
    let fallback: t.Expression | undefined;
    if (local.type === "AssignmentPattern") {
      fallback = local.right as t.Expression;
      local = local.left;
    }
    if (local.type !== "Identifier") continue;
    const bound = lookup(key) ?? (fallback ? resolveExpr(fallback, ctx) ?? fallback : undefined);
    if (bound !== undefined) scope.set(local.name, bound);
  }

  // `const { onPointerDown, ...rest } = props` — rest keeps everything the
  // pattern did not name, and components forward it onto a real element.
  const rest = param.properties.find((prop) => prop.type === "RestElement");
  if (rest?.type === "RestElement" && rest.argument.type === "Identifier" && entries) {
    scope.set(rest.argument.name, objectFrom(entries().filter(([key]) => !taken.has(key))));
  }
}

/** Build an object literal from resolved key/value pairs. */
function objectFrom(pairs: Array<[string, t.Expression | number]>): t.ObjectExpression {
  const properties = pairs.map(([name, value]) => ({
    type: "ObjectProperty",
    key: { type: "Identifier", name },
    value: literalFor(value),
    computed: false,
    shorthand: false,
  })) as t.ObjectProperty[];
  return { type: "ObjectExpression", properties } as t.ObjectExpression;
}

/** Every readable key/value pair of an expression that resolves to an object. */
function entriesOf(value: t.Expression | number | undefined, ctx: Ctx): Array<[string, t.Expression | number]> {
  if (value === undefined || typeof value === "number") return [];
  const res = resolveExpr(value, ctx);
  const obj = res && typeof res !== "number" ? unwrap(res) : undefined;
  if (obj?.type !== "ObjectExpression") return [];
  const out: Array<[string, t.Expression | number]> = [];
  for (const prop of objectProperties(obj, ctx, 0)) {
    const name = propertyName(prop);
    if (name !== undefined) out.push([name, prop.value as t.Expression]);
  }
  return out;
}

/** Reads `key` off an expression the way `value.key` would. */
function propertyLookup(value: t.Expression, ctx: Ctx) {
  return (key: string): t.Expression | number | undefined => {
    const member = {
      type: "MemberExpression",
      object: value,
      property: { type: "Identifier", name: key },
      computed: false,
    } as t.MemberExpression;
    return resolveExpr(member, ctx);
  };
}

function literalFor(value: t.Expression | number): t.Expression {
  return typeof value === "number" ? ({ type: "NumericLiteral", value } as t.NumericLiteral) : value;
}

/**
 * Bind an inlined component's parameters to the JSX attributes at the call
 * site, so its body resolves `items`, `className`, `props.title` the way React
 * would. Without this, every `{items.map(...)}` inside a reusable section
 * component drops out and the section renders empty.
 *
 * Attribute values are resolved in the CALLER's scope first, since the binding
 * we are about to push may shadow the very names they refer to.
 */
function bindComponentProps(fn: ComponentFn, el: t.JSXElement, ctx: Ctx): Scope {
  const scope: Scope = new Map();
  const param = fn.params[0];
  if (!param) return scope;

  const attrs = new Map<string, t.Expression | number>();
  for (const attr of expandSpreadAttributes(el.openingElement.attributes, ctx)) {
    if (attr.name.type !== "JSXIdentifier") continue;
    let expr: t.Expression | undefined;
    if (!attr.value) expr = { type: "BooleanLiteral", value: true } as t.BooleanLiteral;
    else if (attr.value.type === "StringLiteral") expr = attr.value;
    else if (attr.value.type === "JSXExpressionContainer" && attr.value.expression.type !== "JSXEmptyExpression") {
      expr = attr.value.expression;
    }
    if (!expr) continue;
    let value = resolveExpr(expr, ctx) ?? expr;
    // Flatten spreads here, while the caller's scope is still the active one.
    // `stats={[featured, ...stats]}` on a component whose own prop is also
    // named `stats` would otherwise resolve the spread against the binding we
    // are building and lose every inherited row.
    if (typeof value !== "number") {
      const arr = unwrap(value);
      if (arr.type === "ArrayExpression") {
        value = { type: "ArrayExpression", elements: flattenElements(arr, ctx) } as t.ArrayExpression;
      }
    }
    attrs.set(attr.name.name, value);
  }

  if (param.type === "Identifier") {
    // function Card(props) — rebuild the props object so props.x resolves.
    const properties = [...attrs].map(([name, value]) => ({
      type: "ObjectProperty",
      key: { type: "Identifier", name },
      value: literalFor(value),
      computed: false,
      shorthand: false,
    })) as t.ObjectProperty[];
    scope.set(param.name, { type: "ObjectExpression", properties } as t.ObjectExpression);
    return scope;
  }

  bindPattern(param, undefined, (key) => attrs.get(key), scope, ctx, () => [...attrs]);
  return scope;
}

/**
 * Bind a component body's own destructuring against the props already in scope:
 *   const { onPointerDown, ...rest } = props
 * Without this, `rest` is unresolvable and the `<img {...rest} />` it feeds
 * renders with no src and no classes at all. Scoped to this inlining rather
 * than the global const map, so two components using the same local name
 * cannot shadow each other.
 */
function bindBodyDestructuring(fn: ComponentFn, scope: Scope, ctx: Ctx): void {
  if (fn.body.type !== "BlockStatement") return;
  for (const stmt of fn.body.body) {
    if (stmt.type !== "VariableDeclaration") continue;
    for (const decl of stmt.declarations) {
      if (decl.id.type !== "ObjectPattern" || !decl.init) continue;
      const source = decl.init;
      const resolved = resolveExpr(source, ctx);
      if (resolved === undefined) continue;
      bindPattern(
        decl.id,
        resolved,
        typeof resolved === "number" ? () => undefined : propertyLookup(resolved, ctx),
        scope,
        ctx,
        () => entriesOf(resolved, ctx),
      );
    }
  }
}

/**
 * Bind a component body's own declarations into the scope of this inlining:
 *   const active = groups[Math.min(stage, groups.length - 1)];
 *   const [stage, setStage] = useState(0);
 * Without this, every component's `active` lands in one global map and the
 * last definition wins — the video carousel reads the accordion's state and
 * renders nothing. Values are stored unresolved and resolved on lookup, so
 * locals can reference props and each other in any order.
 */
/** [start, end) of the bundled file that contains `offset`. */
function fileRangeOf(offset: number, ctx: Ctx): [number, number] {
  let start = 0;
  let end = Number.MAX_SAFE_INTEGER;
  for (const s of ctx.fileStarts) {
    if (s <= offset) start = s;
    else { end = s; break; }
  }
  return [start, end];
}

/**
 * `import { pgpOutClass as data }` in one file and `import { pgpImmersions as
 * data }` in the next: an alias means something only inside its own file, so
 * it is bound per component rather than into the global const map.
 */
function bindImportAliases(fn: ComponentFn, scope: Scope, ctx: Ctx): void {
  if (ctx.importAliases.length === 0) return;
  const [start, end] = fileRangeOf(fn.start ?? 0, ctx);
  for (const alias of ctx.importAliases) {
    if (alias.at < start || alias.at >= end || scope.has(alias.local)) continue;
    scope.set(alias.local, { type: "Identifier", name: alias.imported } as t.Identifier);
  }
}

function bindBodyLocals(fn: ComponentFn, scope: Scope, ctx: Ctx): void {
  bindImportAliases(fn, scope, ctx);
  if (fn.body.type !== "BlockStatement") return;
  for (const stmt of fn.body.body) {
    if (stmt.type === "VariableDeclaration") {
      for (const decl of stmt.declarations) {
        if (!decl.init) continue;
        if (decl.id.type === "Identifier") {
          if (!scope.has(decl.id.name)) scope.set(decl.id.name, decl.init);
        } else if (
          decl.id.type === "ArrayPattern" &&
          decl.init.type === "CallExpression" &&
          decl.init.callee.type === "Identifier" &&
          decl.init.callee.name === "useState"
        ) {
          const [stateId] = decl.id.elements;
          if (stateId?.type === "Identifier" && !scope.has(stateId.name)) {
            const init = decl.init.arguments[0];
            scope.set(
              stateId.name,
              init && init.type !== "SpreadElement" && init.type !== "ArgumentPlaceholder"
                ? init
                : ({ type: "NullLiteral" } as t.NullLiteral),
            );
          }
        }
      }
    } else if (stmt.type === "ForStatement") {
      bindChunkLoop(stmt, scope, ctx);
    }
  }
}

/**
 * The carousel idiom that builds pages from a list:
 *   const pages = [];
 *   for (let i = 0; i < items.length; i += PER_PAGE) pages.push(items.slice(i, i + PER_PAGE));
 * Static evaluation can't run loops, but this one shape is a plain chunking
 * and shows up in every pager; rebuild `pages` as a literal array of arrays.
 */
function bindChunkLoop(stmt: t.ForStatement, scope: Scope, ctx: Ctx): void {
  const init = stmt.init;
  if (init?.type !== "VariableDeclaration" || init.declarations.length !== 1) return;
  const counter = init.declarations[0].id;
  if (counter.type !== "Identifier") return;
  const test = stmt.test;
  if (test?.type !== "BinaryExpression" || test.operator !== "<" || test.left.type !== "Identifier" || test.left.name !== counter.name) return;
  if (test.right.type !== "MemberExpression" || test.right.computed || test.right.property.type !== "Identifier" || test.right.property.name !== "length") return;
  const source = test.right.object as t.Expression;
  const update = stmt.update;
  if (update?.type !== "AssignmentExpression" || update.operator !== "+=") return;
  const stepExpr = update.right;

  const body = stmt.body.type === "BlockStatement" ? stmt.body.body[0] : stmt.body;
  if (body?.type !== "ExpressionStatement" || body.expression.type !== "CallExpression") return;
  const call = body.expression;
  if (call.callee.type !== "MemberExpression" || call.callee.computed) return;
  if (call.callee.object.type !== "Identifier" || call.callee.property.type !== "Identifier" || call.callee.property.name !== "push") return;
  const target = call.callee.object.name;
  const pushed = call.arguments[0];
  if (!pushed || pushed.type !== "CallExpression" || pushed.callee.type !== "MemberExpression" || pushed.callee.computed) return;
  if (pushed.callee.property.type !== "Identifier" || pushed.callee.property.name !== "slice") return;

  const existing = scope.get(target) ?? ctx.consts.get(target);
  if (!existing || typeof existing === "number" || unwrap(existing).type !== "ArrayExpression") return;

  ctx.scopes.push(scope);
  const size = staticValue(stepExpr, ctx);
  const srcRes = resolveExpr(source, ctx);
  ctx.scopes.pop();
  const src = srcRes && typeof srcRes !== "number" ? unwrap(srcRes) : undefined;
  if (typeof size !== "number" || size < 1 || src?.type !== "ArrayExpression") return;

  const items = flattenElements(src, ctx);
  const pages: t.ArrayExpression[] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push({ type: "ArrayExpression", elements: items.slice(i, i + size) } as t.ArrayExpression);
  }
  scope.set(target, { type: "ArrayExpression", elements: pages } as t.ArrayExpression);
}

/** `children`, `props.children`, or React.Children.toArray/map/only(children). */
function isChildrenRef(e: t.Expression): boolean {
  if (e.type === "Identifier") return e.name === "children";
  if (e.type === "MemberExpression") {
    return !e.computed && e.object.type === "Identifier" && e.object.name === "props" &&
      e.property.type === "Identifier" && e.property.name === "children";
  }
  if (e.type === "CallExpression" && e.callee.type === "MemberExpression") {
    const prop = e.callee.property;
    const method = prop.type === "Identifier" ? prop.name : "";
    if (!["toArray", "map", "only", "count"].includes(method)) return false;
    const obj = e.callee.object;
    const onChildren =
      (obj.type === "Identifier" && obj.name === "Children") ||
      (obj.type === "MemberExpression" && !obj.computed &&
        obj.property.type === "Identifier" && obj.property.name === "Children");
    if (!onChildren) return false;
    const arg = e.arguments[0];
    return !!arg && arg.type !== "SpreadElement" && isChildrenRef(arg as t.Expression);
  }
  return false;
}

/**
 * A wrapper component whose children only reach the DOM through runtime code —
 * a measured sticky-panel layout, a portal, `Children.toArray(children).map()` —
 * renders nothing once that code is stripped, silently swallowing whole page
 * sections. Re-attach the caller's children to the wrapper's own root instead.
 */
function adoptChildren(nodes: TreeNode[], children: TreeNode[], ctx: Ctx, name: string): TreeNode[] {
  note(ctx, `<${name}> lays its children out at runtime — they were placed inside it directly instead.`);
  const roots = nodes.filter((n): n is Extract<TreeNode, { t: "e" }> => n.t === "e");
  if (roots.length === 1) {
    roots[0].children = [...roots[0].children, ...children];
    return nodes;
  }
  return [...nodes, ...children];
}

async function convertElement(el: t.JSXElement, ctx: Ctx, inSvg: boolean, parentTag = "div"): Promise<TreeNode[]> {
  const nameStr = elementNameToString(el.openingElement.name);
  const name = el.openingElement.name;
  const sectioned = ctx.sectionWrappers.has(el);

  // <item.icon /> style dynamic icon
  if (name.type === "JSXMemberExpression") {
    const icon = resolveMemberIcon(name, ctx);
    if (icon) return lucideFromAttrs(icon, el, ctx);

    // <motion.section className="..."> renders the plain tag it wraps. Its
    // animation props are dropped, which lands the element on its *finished*
    // state — the right choice when nothing will ever animate it into view.
    const motionTag = motionElementTag(name);
    if (motionTag) {
      const svgNow = inSvg || motionTag === "svg";
      const { props } = await convertAttributes(el.openingElement.attributes, motionTag, ctx, svgNow);
      for (const key of MOTION_PROPS) delete props[key];
      const label = `${nameStr} (rendered as <${motionTag}>)`;
      if (!ctx.report.unknownComponents.includes(label)) ctx.report.unknownComponents.push(label);
      const children = VOID_TAGS.has(motionTag) ? [] : await convertChildren(el.children, ctx, motionTag, svgNow, sectioned);
      return [{ t: "e", tag: motionTag, props, children, from: nameStr }];
    }

    if (!ctx.report.unknownComponents.includes(nameStr)) ctx.report.unknownComponents.push(nameStr);
    const { props } = await convertAttributes(el.openingElement.attributes, "div", ctx, inSvg);
    const children = await convertChildren(el.children, ctx, "div", inSvg);
    return [{ t: "e", tag: "div", props, children, from: nameStr }];
  }

  if (name.type === "JSXNamespacedName") return [];

  const isHtml = /^[a-z]/.test(nameStr);

  if (isHtml) {
    if (nameStr === "script") {
      note(ctx, "A <script> element was stripped.");
      return [];
    }
    const svgNow = inSvg || nameStr === "svg";
    const { props } = await convertAttributes(el.openingElement.attributes, nameStr, ctx, svgNow, parentTag);
    const children = VOID_TAGS.has(nameStr) ? [] : await convertChildren(el.children, ctx, nameStr, svgNow, sectioned);
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

  // Pure controllers with no DOM output of their own.
  if (nameStr === "Fragment" || nameStr === "AnimatePresence" || nameStr === "LazyMotion") {
    return convertChildren(el.children, ctx, "div", inSvg, sectioned);
  }

  // Component defined in the pasted source itself (Lovable splits pages into
  // section components — Header, Hero, ... — pasted together with the page):
  // inline its returned JSX in place.
  const local = ctx.localComponents.get(nameStr);
  if (local && !ctx.inlineStack.includes(nameStr) && ctx.inlineStack.length < 20) {
    const body = componentReturnExpr(local);
    if (body) {
      // <HomeSections /> used as a section: if its body is a bare list of
      // sections, name fields after those instead of after the component.
      if (ctx.sectionRoots.has(el) && !el.children.some((c) => c.type === "JSXElement")) {
        const root = unwrap(body);
        if ((root.type === "JSXElement" || root.type === "JSXFragment") && isSectionWrapper(root, ctx)) {
          ctx.sectionWrappers.add(root);
        }
      }
      const frame: ChildrenFrame = {
        nodes: await convertChildren(el.children, ctx, "div", inSvg, sectioned),
        used: false,
      };
      const props = bindComponentProps(local, el, ctx);
      ctx.inlineStack.push(nameStr);
      ctx.childrenStack.push(frame);
      ctx.scopes.push(props);
      bindBodyDestructuring(local, props, ctx);
      bindBodyLocals(local, props, ctx);
      const nodes = await convertExpression(body, ctx, "div", inSvg);
      ctx.scopes.pop();
      ctx.childrenStack.pop();
      ctx.inlineStack.pop();
      const hasContent = frame.nodes.some((n) => n.t !== "x");
      if (!frame.used && hasContent) return adoptChildren(nodes, frame.nodes, ctx, nameStr);
      return nodes;
    }
  }

  if (nameStr === "Link") {
    const { props } = await convertAttributes(el.openingElement.attributes, "a", ctx, inSvg);
    const children = await convertChildren(el.children, ctx, "a", inSvg);
    if (!ctx.report.unknownComponents.includes("Link (rendered as <a>)")) {
      ctx.report.unknownComponents.push("Link (rendered as <a>)");
    }
    return [{ t: "e", tag: "a", props, children, from: "Link" }];
  }

  // Popovers, dialogs, menus: closed until a click opens them, and nothing
  // will. Rendering their content inline would dump modal bodies into the page.
  if (CLOSED_OVERLAYS.has(nameStr)) {
    note(ctx, `<${nameStr}> opens on interaction, so its content is not part of the static page.`);
    return [];
  }

  const mapped = COMPONENT_TAG_MAP[nameStr];
  const tag = mapped ?? "div";
  const converted = await convertAttributes(el.openingElement.attributes, tag, ctx, inSvg);
  // A component's props are its API, not DOM attributes: `collapsible`,
  // `type="single"`, `orientation` on a <div> are invalid HTML and make React
  // warn. Keep what a plain element understands.
  const props: Record<string, PropValue> = {};
  for (const [key, value] of Object.entries(converted.props)) {
    if (PASSTHROUGH_PROPS.has(key) || key.startsWith("data-") || key.startsWith("aria-")) props[key] = value;
    else if (key === "type" && (tag === "button" || tag === "input")) props[key] = value;
  }

  // Apply the component's stock shadcn styling; instance classes win.
  const defaults = shadcnDefaultClasses(nameStr, props);
  if (defaults) {
    props.className = twMerge(defaults, typeof props.className === "string" ? props.className : "");
  }
  delete props.variant;
  delete props.size;
  delete props.asChild;

  const children = await convertChildren(el.children, ctx, tag, inSvg, sectioned);
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

const SECTION_TAGS = new Set(["section", "header", "footer", "main", "article", "nav", "aside"]);

/**
 * An element that only groups sections: a fragment, a local component or a
 * plain container with no text of its own whose element children are (mostly)
 * section-like — `<section>`, `<header>`, PascalCase components, motion tags —
 * or containers that qualify in turn. Its children are named as sections
 * instead of the wrapper, so a page built as
 * `<div id="curtain"><section/><div><TenThings/><HomeSections/></div></div>`
 * does not put every field under one "curtain" heading.
 */
function isSectionWrapper(el: t.JSXElement | t.JSXFragment, ctx: Ctx, depth = 0): boolean {
  if (depth > 3) return false;
  if (el.type === "JSXElement") {
    const name = el.openingElement.name;
    const nameStr = elementNameToString(name);
    const isMotion = name.type === "JSXMemberExpression" && motionElementTag(name) !== undefined;
    const isContainer =
      nameStr === "div" || nameStr === "main" || isMotion || nameStr === "Fragment" ||
      (/^[A-Z]/.test(nameStr) && (ctx.localComponents.has(nameStr) || !COMPONENT_TAG_MAP[nameStr]));
    if (!isContainer) return false;
  }

  const hasOwnText = el.children.some(
    (c) => (c.type === "JSXText" && c.value.trim() !== "") ||
      (c.type === "JSXExpressionContainer" && c.expression.type !== "JSXEmptyExpression" && c.expression.type !== "JSXElement"),
  );
  if (hasOwnText) return false;

  const kids = el.children.filter((c): c is t.JSXElement => c.type === "JSXElement");
  if (kids.length < 2) return false;
  const sectionLike = kids.filter((k) => {
    const kn = k.openingElement.name;
    const kname = elementNameToString(kn);
    if (kn.type === "JSXMemberExpression") return motionElementTag(kn) !== undefined;
    if (SECTION_TAGS.has(kname)) return true;
    if (/^[A-Z]/.test(kname) && !ctx.lucide.has(kname) && !COMPONENT_TAG_MAP[kname]) return true;
    return kname === "div" && isSectionWrapper(k, ctx, depth + 1);
  });
  return sectionLike.length >= Math.max(2, Math.ceil(kids.length * 0.6));
}

function componentKebab(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function sectionSlugFor(el: t.JSXElement | undefined, index: number, ctx: Ctx): string {
  let base = `section-${index + 1}`;
  if (el) {
    const name = el.openingElement.name;
    const tag = name.type === "JSXIdentifier" ? name.name : "";
    let hint = "";
    // A section component's own name is the best slug: <WhyRealEstate /> → why-real-estate
    if (/^[A-Z]/.test(tag)) hint = componentKebab(tag);
    for (const attr of el.openingElement.attributes) {
      if (hint) break;
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
// Component helpers
// ---------------------------------------------------------------------------

function asComponentFn(n: t.Node | undefined): ComponentFn | undefined {
  return n && (n.type === "FunctionDeclaration" || n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression")
    ? n : undefined;
}

/**
 * TanStack Start route files never export their page component: they hand it
 * to the route factory, `createFileRoute("/about")({ component: AboutPage })`.
 * Returns the `component` value (an identifier or an inline function).
 */
function routeFactoryComponent(node: t.CallExpression): t.Node | undefined {
  if (node.callee.type !== "CallExpression") return undefined;
  const factory = node.callee.callee;
  if (factory.type !== "Identifier" || !/^create(Lazy)?FileRoute$/.test(factory.name)) return undefined;
  const options = node.arguments[0];
  if (options?.type !== "ObjectExpression") return undefined;
  for (const prop of options.properties) {
    if (prop.type !== "ObjectProperty") continue;
    const key = prop.key;
    const name = key.type === "Identifier" ? key.name : key.type === "StringLiteral" ? key.value : "";
    if (name === "component") return prop.value;
  }
  return undefined;
}

/** The expression a component function returns (its JSX, usually). */
function componentReturnExpr(fn: ComponentFn): t.Expression | undefined {
  if (fn.body.type !== "BlockStatement") return fn.body;
  let ret: t.Expression | undefined;
  for (const stmt of fn.body.body) {
    if (stmt.type === "ReturnStatement" && stmt.argument) ret = stmt.argument;
  }
  return ret;
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

export async function extractPage(
  source: string,
  options?: { assetUrls?: Map<string, string> },
): Promise<ExtractResult> {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
    errorRecovery: true,
  });

  const ctx: Ctx = {
    localComponents: new Map(),
    inlineStack: [],
    functions: new Map(),
    callStack: [],
    childrenStack: [],
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
    assetUrls: options?.assetUrls ?? new Map(),
    assetLiterals: new Map(),
    sectionWrappers: new Set(),
    sectionRoots: new Set(),
    importAliases: [],
    fileStarts: [...source.matchAll(/^\/\/ ===== .+ =====$/gm)].map((m) => m.index ?? 0),
    stateInits: new Map(),
    section: "page",
    sectionCounts: new Map(),
    sort: { n: 0 },
  };

  // Both candidate entry points are tracked with their position in the
  // source: bundles concatenate the page file LAST, so the later construct is
  // the page and a bundled component's `export default` must not outrank it.
  let entryPoint: t.Node | undefined;
  let entryPointAt = -1;
  const functions = new Map<string, t.FunctionDeclaration>();

  walk(ast.program, (node) => {
    switch (node.type) {
      case "ImportDeclaration": {
        const src = node.source.value;
        for (const spec of node.specifiers) {
          if (src === "lucide-react" && spec.type === "ImportSpecifier") {
            const imported = spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value;
            ctx.lucide.set(spec.local.name, imported);
          } else if (isAssetSpecifier(src) && spec.type === "ImportDefaultSpecifier") {
            ctx.assetImports.set(spec.local.name, src);
          } else if (spec.type === "ImportSpecifier" && (src.startsWith(".") || src.startsWith("@/"))) {
            const imported = spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value;
            if (imported !== spec.local.name) {
              ctx.importAliases.push({ local: spec.local.name, imported, at: node.start ?? 0 });
            }
          }
        }
        break;
      }
      case "VariableDeclaration": {
        // Module-level and component-body consts both become resolvable data.
        // A declaration never overwrites an already-collected component —
        // in multi-file pastes an `import { Header }` line in another file
        // must not shadow the real `const Header = ...` definition (imports
        // aren't collected here, but two same-named consts can collide;
        // first definition wins).
        for (const decl of node.declarations) {
          if (decl.id.type === "Identifier" && decl.init) {
            if (!ctx.consts.has(decl.id.name)) ctx.consts.set(decl.id.name, decl.init);
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
        break;
      }
      case "FunctionDeclaration":
        if (node.id && !functions.has(node.id.name)) functions.set(node.id.name, node);
        break;
      case "ExportDefaultDeclaration":
        if ((node.start ?? 0) >= entryPointAt) {
          entryPoint = node.declaration;
          entryPointAt = node.start ?? 0;
        }
        break;
      case "CallExpression": {
        const routeComponent = routeFactoryComponent(node);
        if (routeComponent && (node.start ?? 0) >= entryPointAt) {
          entryPoint = routeComponent;
          entryPointAt = node.start ?? 0;
        }
        break;
      }
    }
  });

  // Every function is a candidate data helper (`withSections(c)`), not only the
  // PascalCase ones that are components.
  for (const [name, fn] of functions) ctx.functions.set(name, fn);
  for (const [name, init] of ctx.consts) {
    const fn = asComponentFn(init);
    if (fn && !ctx.functions.has(name)) ctx.functions.set(name, fn);
  }

  // Register every component defined in the pasted source (PascalCase name,
  // function returning something) so <Header /> etc. can be inlined.
  for (const [name, fn] of functions) {
    if (/^[A-Z]/.test(name)) ctx.localComponents.set(name, fn);
  }
  for (const [name, init] of ctx.consts) {
    const fn = asComponentFn(init);
    if (fn && /^[A-Z]/.test(name)) ctx.localComponents.set(name, fn);
  }

  // Locate the page component
  let component = asComponentFn(entryPoint);
  if (!component && entryPoint?.type === "Identifier") {
    component = functions.get(entryPoint.name) ?? asComponentFn(ctx.consts.get(entryPoint.name));
  }
  if (!component) {
    // Fallback: first top-level function component
    component = ctx.localComponents.values().next().value;
  }
  if (!component) throw new Error("Could not find a React component in the pasted code. Paste the full exported page component.");

  // Find the returned JSX
  let rootExpr = componentReturnExpr(component);
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

  // The page component's own locals shadow the global const map too.
  const rootScope: Scope = new Map();
  bindBodyDestructuring(component, rootScope, ctx);
  bindBodyLocals(component, rootScope, ctx);
  ctx.scopes.push(rootScope);

  let container: JsxParent = rootExpr;
  const wrappers: t.JSXElement[] = [];
  // Prop bindings picked up while stepping through component boundaries. A page
  // that is simply <ResponsiveCardGrid cards={CARDS} /> has all of its content
  // in those props, so they have to stay in scope for the conversion below.
  const descentScopes: Scope[] = [];
  for (let hops = 0; hops < 30 && container.type === "JSXElement"; hops++) {
    const cname = elementNameToString(container.openingElement.name);
    // Step transparently through a local component boundary (<HomePage/> whose
    // body holds the real sections).
    const localFn = ctx.localComponents.get(cname);
    if (localFn) {
      // A component with its own nested children has to go through the normal
      // inline path, which binds props AND children. Stepping into its body
      // here would silently drop everything the caller nested inside it, so
      // back off one level and let it be converted as an ordinary section.
      const nested = container.children.some(
        (c) =>
          c.type === "JSXElement" ||
          c.type === "JSXFragment" ||
          (c.type === "JSXExpressionContainer" && c.expression.type !== "JSXEmptyExpression") ||
          (c.type === "JSXText" && c.value.trim() !== ""),
      );
      if (nested) {
        const parent = wrappers.pop();
        if (parent) container = parent;
        break;
      }
      const inner = componentReturnExpr(localFn);
      const unwrapped = inner ? unwrap(inner) : undefined;
      if (unwrapped && (unwrapped.type === "JSXElement" || unwrapped.type === "JSXFragment")) {
        const scope = bindComponentProps(localFn, container, ctx);
        ctx.scopes.push(scope);
        bindBodyDestructuring(localFn, scope, ctx);
        bindBodyLocals(localFn, scope, ctx);
        descentScopes.push(scope);
        container = unwrapped;
        continue;
      }
      break;
    }
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
    if (el && isSectionWrapper(el, ctx)) {
      // <StackReveal><Hero/><Stats/><Gallery/></StackReveal>: the wrapper is
      // scroll choreography, its children are the sections admins think in.
      ctx.sectionWrappers.add(el);
      ctx.section = "page";
    } else {
      if (el) ctx.sectionRoots.add(el);
      ctx.section = sectionSlugFor(el, sectionIndex, ctx);
      sectionIndex++;
    }
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
  for (let i = 0; i < descentScopes.length; i++) ctx.scopes.pop();
  ctx.scopes.pop(); // rootScope

  flattenScrollDecks(tree, ctx);
  revealHiddenPanels(tree, ctx);
  for (const root of tree) {
    if (root.t === "e" && carriesContent(root) && hiddenByUtilityClass(root)) unhideUtilityClasses(root);
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

type ElementNode = Extract<TreeNode, { t: "e" }>;

const POSITIONED = /(^|\s)(absolute|fixed|sticky)(\s|$)/;

/**
 * A utility class hiding an element that a runtime flag was going to turn on
 * (`navVisible ? "opacity-100" : "opacity-0"` resolves to the closed state,
 * since state is stripped). Positioned elements are excluded: those are
 * crossfade layers and overlays where a sibling already occupies the space, so
 * revealing them stacks two things on top of each other instead of helping.
 */
function hiddenByUtilityClass(n: ElementNode): boolean {
  const cls = typeof n.props.className === "string" ? n.props.className : "";
  if (!cls || POSITIONED.test(cls)) return false;
  return /(^|\s)(opacity-0|invisible)(\s|$)/.test(cls);
}

function unhideUtilityClasses(n: ElementNode): void {
  const cls = typeof n.props.className === "string" ? n.props.className : "";
  const kept = cls
    .split(/\s+/)
    .filter((c) => c !== "opacity-0" && c !== "invisible" && c !== "pointer-events-none");
  n.props.className = kept.join(" ");
}

/** Inline styles that hide an element outright, whatever its classes say. */
function hiddenByStyle(n: ElementNode): boolean {
  const style = n.props.style;
  if (!style || typeof style !== "object" || isFieldRef(style)) return false;
  const s = style as Record<string, StyleValue>;
  return s.opacity === 0 || s.opacity === "0" || s.visibility === "hidden" || s.display === "none";
}

function showElement(n: ElementNode): void {
  const style = n.props.style;
  if (!style || typeof style !== "object" || isFieldRef(style)) return;
  const s = { ...(style as Record<string, StyleValue>) };
  delete s.opacity;
  delete s.visibility;
  delete s.display;
  if (Object.keys(s).length === 0) delete n.props.style;
  else n.props.style = s;
}

/** Text or media the reader would actually miss if this subtree stayed hidden. */
function carriesContent(n: TreeNode): boolean {
  if (n.t === "f") return true;
  if (n.t === "x") return n.v.trim().length > 0;
  if (n.tag === "img" || n.tag === "video" || n.tag === "svg") return true;
  return n.children.some(carriesContent);
}

/**
 * Scroll-driven decks ship their panels hidden inline
 * (`style={{ opacity: 0, visibility: "hidden" }}`) and un-hide them from a
 * scroll handler that never runs here, so the whole section renders blank.
 *
 * Reveal the first panel of any such group — but only when EVERY panel in it is
 * hidden. A group with one visible panel is a deck already showing its first
 * slide, and revealing more would stack absolutely-positioned panels on top of
 * one another instead of fixing anything.
 */
function revealHiddenPanels(nodes: TreeNode[], ctx: Ctx): void {
  for (const node of nodes) {
    if (node.t !== "e") continue;
    const panels = node.children.filter((c): c is ElementNode => c.t === "e" && carriesContent(c));
    const hidden = panels.filter(hiddenByStyle);
    if (hidden.length > 0 && hidden.length === panels.length) {
      showElement(hidden[0]);
      note(
        ctx,
        `A scroll-revealed panel group was hidden until its scroll code ran \u2014 its first panel is shown instead (${hidden.length - 1} more remain hidden).`,
      );
    }
    for (const child of panels) {
      if (hiddenByUtilityClass(child)) {
        unhideUtilityClasses(child);
        note(ctx, "An element was left hidden by a runtime visibility flag \u2014 it is shown, since nothing will switch it on here.");
      }
    }
    revealHiddenPanels(node.children, ctx);
  }
}

const RUNWAY_CLASS = /^(min-)?h-\[(\d+)(vh|svh|dvh|lvh)\]$/;
const RUNWAY_STYLE = /^(\d+)(vh|svh|dvh|lvh)$/;

function classTokens(n: ElementNode): string[] {
  return typeof n.props.className === "string" ? n.props.className.split(/\s+/).filter(Boolean) : [];
}

function setClassTokens(n: ElementNode, tokens: string[]) {
  if (tokens.length) n.props.className = tokens.join(" ");
  else delete n.props.className;
}

function styleOf(n: ElementNode): Record<string, StyleValue> | undefined {
  const style = n.props.style;
  return style && typeof style === "object" && !isFieldRef(style) ? (style as Record<string, StyleValue>) : undefined;
}

/** A section made taller than the viewport only to give a sticky child room to scroll. */
function runwayHeight(n: ElementNode): boolean {
  for (const tok of classTokens(n)) {
    const m = RUNWAY_CLASS.exec(tok);
    if (m && Number(m[2]) > 100) return true;
  }
  const style = styleOf(n);
  for (const key of ["height", "minHeight"]) {
    const v = style?.[key];
    const m = typeof v === "string" ? RUNWAY_STYLE.exec(v.trim()) : null;
    if (m && Number(m[1]) > 100) return true;
  }
  return false;
}

/**
 * Scroll-driven decks pin a viewport-sized child while the page scrolls
 * through a 200–400vh runway, swapping stacked absolute panels as it goes:
 *
 *   <section style={{ height: "340vh" }}>
 *     <div className="sticky top-0 h-screen overflow-hidden">
 *       <div className="absolute inset-0">Semester 01</div>
 *       <div className="absolute inset-0">Semester 02</div>
 *
 * Nothing scrolls the deck here, so the reader gets one panel and a screen
 * or two of blank runway. Lay it out as an ordinary sequence instead: drop
 * the runway height, un-pin the child, and let the panels flow one after
 * another — every panel visible and editable.
 */
function flattenScrollDecks(nodes: TreeNode[], ctx: Ctx): void {
  for (const node of nodes) {
    if (node.t !== "e") continue;
    if (runwayHeight(node)) {
      const sticky = node.children.find(
        (c): c is ElementNode => c.t === "e" && classTokens(c).includes("sticky"),
      );
      if (sticky) {
        setClassTokens(node, classTokens(node).filter((tok) => !RUNWAY_CLASS.test(tok)));
        const style = styleOf(node);
        if (style) {
          for (const key of ["height", "minHeight"]) {
            const v = style[key];
            if (typeof v === "string" && RUNWAY_STYLE.test(v.trim())) delete style[key];
          }
          if (Object.keys(style).length === 0) delete node.props.style;
        }
        const drop = new Set(["sticky", "top-0", "h-screen", "h-svh", "h-dvh", "overflow-hidden"]);
        setClassTokens(sticky, classTokens(sticky).filter((tok) => !drop.has(tok)));

        const panels = sticky.children.filter(
          (c): c is ElementNode =>
            c.t === "e" && carriesContent(c) &&
            classTokens(c).includes("absolute") && classTokens(c).includes("inset-0"),
        );
        if (panels.length >= 2) {
          for (const panel of panels) {
            const keep = classTokens(panel).filter((tok) => !["absolute", "inset-0", "will-change-transform"].includes(tok));
            setClassTokens(panel, keep);
            showElement(panel);
          }
          // A label bar pinned to the deck's top edge would now sit over the
          // first panel; let it lead the sequence instead.
          for (const c of sticky.children) {
            if (c.t !== "e" || panels.includes(c) || !carriesContent(c)) continue;
            const toks = classTokens(c);
            if (toks.includes("absolute") && toks.includes("top-0")) {
              setClassTokens(c, toks.filter((tok) => !["absolute", "top-0", "inset-x-0", "left-0", "right-0", "pointer-events-none"].includes(tok)));
            }
          }
        }
        note(ctx, "A scroll-driven deck was laid out as a plain sequence so every panel is visible.");
      }
    }
    flattenScrollDecks(node.children, ctx);
  }
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
