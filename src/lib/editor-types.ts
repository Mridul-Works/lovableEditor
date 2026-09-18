import type { FieldType } from "@/lib/tree";

// Shapes shared by the admin editor, the on-page overlay, the live preview
// bridge and the JSON routes that feed them. Plain data only — this module is
// imported from both server and client code.

export type FieldData = {
  id: string;
  key: string;
  type: FieldType;
  label: string;
  section: string;
  defaultValue: string;
  value: string | null;
  orphaned: boolean;
  sortOrder: number;
};

export type PageSummary = {
  id: string;
  route: string;
  title: string;
  status: "DRAFT" | "PUBLISHED";
  sourceRepo: string | null;
  updatedAt: string;
};

export type PageFieldsResponse = { page: PageSummary; fields: FieldData[] };

export type AssetData = {
  id: string;
  url: string;
  filename: string;
  width: number | null;
  height: number | null;
  size: number;
  createdAt: string;
};

export type MediaPageResponse = { assets: AssetData[]; nextCursor: string | null };

export const queryKeys = {
  pageFields: (pageId: string) => ["page-fields", pageId] as const,
  media: (kind: "image" | "video", query: string) => ["media", kind, query] as const,
};

/**
 * Messages between the editor and the page rendered inside its preview
 * iframe. Both ends check `event.origin` against their own origin; the
 * protocol carries field keys and values, never markup or code.
 */
export type PreviewMessage =
  | { cms: "ready" }
  | { cms: "ack" }
  | { cms: "hello" }
  | { cms: "set"; key: string; type: FieldType; value: string }
  | { cms: "select"; key: string }
  | { cms: "highlight"; key: string | null };

export function isPreviewMessage(data: unknown): data is PreviewMessage {
  return typeof data === "object" && data !== null && typeof (data as { cms?: unknown }).cms === "string";
}
