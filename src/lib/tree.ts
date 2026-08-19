// The serialized render tree produced by the importer and consumed by the
// renderer. Imported code only ever exists in this JSON form — it is data,
// never executed.

/** A reference to a content field, used where a literal string used to be. */
export type FieldRef = { $f: string };

export function isFieldRef(v: unknown): v is FieldRef {
  return typeof v === "object" && v !== null && "$f" in v && typeof (v as FieldRef).$f === "string";
}

export type StyleValue = string | number | FieldRef;

export type PropValue =
  | string
  | number
  | boolean
  | FieldRef
  | Record<string, StyleValue>; // style objects

export type ElementNode = {
  t: "e";
  /** Lowercase HTML/SVG tag name. */
  tag: string;
  props: Record<string, PropValue>;
  children: TreeNode[];
  /** Original component name when this is an unknown-component passthrough. */
  from?: string;
};

/** Static text that is not editable (whitespace, separators). */
export type TextNode = { t: "x"; v: string };

/** Editable text content — resolved from the field with this key. */
export type FieldTextNode = { t: "f"; k: string };

export type TreeNode = ElementNode | TextNode | FieldTextNode;

export type ImportReport = {
  textFields: number;
  imageFields: number;
  /** Event handler prop names that were stripped (onClick, ...). */
  strippedHandlers: string[];
  /** Dynamic expressions that could not be converted, as short source snippets. */
  droppedExpressions: string[];
  /** Component names rendered as passthrough wrappers. */
  unknownComponents: string[];
  /** Lucide icons rendered as inline SVG. */
  renderedIcons: string[];
  /** Free-form warnings (unresolved image imports, stripped scripts, ...). */
  notes: string[];
  /** Re-import merge counts (absent on first import). */
  merge?: { kept: number; added: number; orphaned: number };
};

export type ExtractedField = {
  key: string;
  type: "TEXT" | "IMAGE";
  defaultValue: string;
  label: string;
  section: string;
  sortOrder: number;
};

export const FIELD_META_TITLE = "meta-title";
export const FIELD_META_DESCRIPTION = "meta-description";
