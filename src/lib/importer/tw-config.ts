import "server-only";
import { parse } from "@babel/parser";
import type * as t from "@babel/types";

// Translates a Lovable project's tailwind.config.ts (Tailwind v3) into
// Tailwind v4 CSS (@theme tokens, @keyframes, @utility rules) so the page's
// custom design tokens — colors, gradients, shadows, fonts, animations —
// compile correctly. The config is parsed as data, never executed.

type Plain = string | number | Plain[] | { [k: string]: Plain };

function unwrapExpr(e: t.Node): t.Node {
  let cur = e;
  while (
    cur.type === "TSAsExpression" ||
    cur.type === "TSSatisfiesExpression" ||
    cur.type === "TSNonNullExpression" ||
    cur.type === "ParenthesizedExpression"
  ) cur = cur.expression;
  return cur;
}

function literalValue(node: t.Node): Plain | undefined {
  const e = unwrapExpr(node);
  switch (e.type) {
    case "StringLiteral": return e.value;
    case "NumericLiteral": return e.value;
    case "TemplateLiteral":
      if (e.expressions.length === 0) return e.quasis[0].value.cooked ?? "";
      return undefined;
    case "ArrayExpression": {
      const out: Plain[] = [];
      for (const el of e.elements) {
        if (!el || el.type === "SpreadElement") continue;
        const v = literalValue(el);
        if (v !== undefined) out.push(v);
      }
      return out;
    }
    case "ObjectExpression": {
      const out: Record<string, Plain> = {};
      for (const prop of e.properties) {
        if (prop.type !== "ObjectProperty") continue;
        const key = prop.key.type === "Identifier" ? prop.key.name
          : prop.key.type === "StringLiteral" ? prop.key.value
          : prop.key.type === "NumericLiteral" ? String(prop.key.value) : undefined;
        if (key === undefined) continue;
        const v = literalValue(prop.value);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    default: return undefined;
  }
}

function findConfigObject(source: string): Record<string, Plain> | null {
  let ast: t.File;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["typescript"], errorRecovery: true });
  } catch {
    return null;
  }

  const consts = new Map<string, t.Node>();
  let candidate: t.Node | undefined;

  for (const stmt of ast.program.body) {
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        if (d.id.type === "Identifier" && d.init) consts.set(d.id.name, d.init);
      }
    } else if (stmt.type === "ExportDefaultDeclaration") {
      candidate = stmt.declaration;
    } else if (
      stmt.type === "ExpressionStatement" &&
      stmt.expression.type === "AssignmentExpression" &&
      stmt.expression.left.type === "MemberExpression"
    ) {
      // module.exports = {...}
      candidate = stmt.expression.right;
    }
  }
  if (candidate) {
    const c = unwrapExpr(candidate);
    if (c.type === "Identifier" && consts.has(c.name)) candidate = consts.get(c.name);
  }
  if (!candidate) return null;
  const value = literalValue(candidate);
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Plain>) : null;
}

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

function flattenColors(obj: Record<string, Plain>, prefix: string, out: string[]) {
  for (const [key, value] of Object.entries(obj)) {
    const path = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${kebab(key)}` : kebab(key);
    if (typeof value === "string") {
      if (path) out.push(`  --color-${path}: ${value};`);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenColors(value as Record<string, Plain>, path, out);
    }
  }
}

function keyframesCss(name: string, frames: Record<string, Plain>): string {
  const blocks: string[] = [];
  for (const [stop, props] of Object.entries(frames)) {
    if (!props || typeof props !== "object" || Array.isArray(props)) continue;
    const decls = Object.entries(props as Record<string, Plain>)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => `${kebab(k)}: ${v};`)
      .join(" ");
    blocks.push(`  ${stop} { ${decls} }`);
  }
  return `@keyframes ${name} {\n${blocks.join("\n")}\n}`;
}

export function tailwindConfigToCss(configSource: string): string {
  const config = findConfigObject(configSource);
  if (!config) return "";

  const theme = (config.theme ?? {}) as Record<string, Plain>;
  const extend = (theme.extend ?? {}) as Record<string, Plain>;
  const merged: Record<string, Plain> = { ...theme, ...extend };

  const themeTokens: string[] = [];
  const extraCss: string[] = [];

  const colors = merged.colors;
  if (colors && typeof colors === "object" && !Array.isArray(colors)) {
    flattenColors(colors as Record<string, Plain>, "", themeTokens);
  }

  const fontFamily = merged.fontFamily;
  if (fontFamily && typeof fontFamily === "object" && !Array.isArray(fontFamily)) {
    for (const [k, v] of Object.entries(fontFamily as Record<string, Plain>)) {
      const stack = Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : undefined;
      if (stack) themeTokens.push(`  --font-${kebab(k)}: ${stack};`);
    }
  }

  const borderRadius = merged.borderRadius;
  if (borderRadius && typeof borderRadius === "object" && !Array.isArray(borderRadius)) {
    for (const [k, v] of Object.entries(borderRadius as Record<string, Plain>)) {
      if (typeof v !== "string") continue;
      themeTokens.push(k === "DEFAULT" ? `  --radius: ${v};` : `  --radius-${kebab(k)}: ${v};`);
    }
  }

  const boxShadow = merged.boxShadow;
  if (boxShadow && typeof boxShadow === "object" && !Array.isArray(boxShadow)) {
    for (const [k, v] of Object.entries(boxShadow as Record<string, Plain>)) {
      if (typeof v !== "string") continue;
      themeTokens.push(k === "DEFAULT" ? `  --shadow: ${v};` : `  --shadow-${kebab(k)}: ${v};`);
    }
  }

  const easing = merged.transitionTimingFunction;
  if (easing && typeof easing === "object" && !Array.isArray(easing)) {
    for (const [k, v] of Object.entries(easing as Record<string, Plain>)) {
      if (typeof v === "string") themeTokens.push(`  --ease-${kebab(k)}: ${v};`);
    }
  }

  // v3 backgroundImage entries (bg-gradient-hero etc.) become custom utilities.
  const backgroundImage = merged.backgroundImage;
  if (backgroundImage && typeof backgroundImage === "object" && !Array.isArray(backgroundImage)) {
    for (const [k, v] of Object.entries(backgroundImage as Record<string, Plain>)) {
      if (typeof v === "string") {
        extraCss.push(`@utility bg-${kebab(k)} {\n  background-image: ${v};\n}`);
      }
    }
  }

  const keyframes = merged.keyframes;
  if (keyframes && typeof keyframes === "object" && !Array.isArray(keyframes)) {
    for (const [k, v] of Object.entries(keyframes as Record<string, Plain>)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        extraCss.push(keyframesCss(k, v as Record<string, Plain>));
      }
    }
  }

  const animation = merged.animation;
  if (animation && typeof animation === "object" && !Array.isArray(animation)) {
    for (const [k, v] of Object.entries(animation as Record<string, Plain>)) {
      if (typeof v === "string") themeTokens.push(`  --animate-${kebab(k)}: ${v};`);
    }
  }

  // container: { center, padding } — Lovable layouts rely on it heavily.
  const container = config.theme && (theme.container ?? extend.container);
  if (container && typeof container === "object" && !Array.isArray(container)) {
    const c = container as Record<string, Plain>;
    const padding = typeof c.padding === "string"
      ? c.padding
      : c.padding && typeof c.padding === "object" && !Array.isArray(c.padding)
        ? (c.padding as Record<string, Plain>).DEFAULT
        : undefined;
    const rules: string[] = [];
    if (c.center === undefined || c.center) rules.push("margin-inline: auto;");
    if (typeof padding === "string") rules.push(`padding-inline: ${padding};`);
    if (rules.length > 0) extraCss.push(`.container {\n  ${rules.join("\n  ")}\n}`);
  }

  const parts: string[] = [];
  if (themeTokens.length > 0) parts.push(`@theme {\n${themeTokens.join("\n")}\n}`);
  parts.push(...extraCss);
  return parts.join("\n\n");
}
