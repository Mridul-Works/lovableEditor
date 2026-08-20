import "server-only";
import { db } from "@/lib/db";
import { extractPage } from "@/lib/importer/extract";
import { compilePageCss } from "@/lib/importer/tailwind";
import type { ImportReport } from "@/lib/tree";

// Shared import pipeline used by both the paste form and GitHub imports.
// Creating vs re-importing is decided by route: re-imports merge fields by
// key so admin edits survive (kept / added / orphaned).

export type ImportInput = {
  route: string; // already normalized
  title?: string;
  source: string;
  themeCss?: string;
  tailwindConfig?: string;
  indexHtml?: string;
  assetUrls?: Map<string, string>;
  /** GitHub origin, when imported from a connected project. */
  origin?: { repo: string; branch: string; path: string };
};

export type ImportOutcome = {
  report: ImportReport;
  pageId: string;
  route: string;
  reimported: boolean;
};

export async function importPageFromSource(input: ImportInput): Promise<ImportOutcome> {
  const { tree, fields, report, title } = await extractPage(input.source, {
    assetUrls: input.assetUrls,
  });
  const compiledCss = await compilePageCss(tree, {
    themeCss: input.themeCss || undefined,
    tailwindConfig: input.tailwindConfig || undefined,
    indexHtml: input.indexHtml || undefined,
  });
  const requestedTitle = input.title?.trim();

  const originData = input.origin
    ? { sourceRepo: input.origin.repo, sourceBranch: input.origin.branch, sourcePath: input.origin.path }
    : {};

  const existing = await db.page.findUnique({
    where: { route: input.route },
    include: { fields: true },
  });

  if (!existing) {
    const page = await db.page.create({
      data: {
        route: input.route,
        title: requestedTitle || title,
        rawSource: input.source,
        tree: JSON.parse(JSON.stringify(tree)),
        compiledCss,
        report: JSON.parse(JSON.stringify(report)),
        ...originData,
        fields: {
          create: fields.map((f) => ({
            key: f.key, type: f.type, defaultValue: f.defaultValue,
            label: f.label, section: f.section, sortOrder: f.sortOrder,
          })),
        },
      },
    });
    return { report, pageId: page.id, route: input.route, reimported: false };
  }

  // Re-import: merge by field key. Existing keys keep their edited value,
  // new keys are added, keys no longer present are flagged orphaned.
  const incomingByKey = new Map(fields.map((f) => [f.key, f]));
  const existingByKey = new Map(existing.fields.map((f) => [f.key, f]));

  let kept = 0, added = 0, orphaned = 0;
  const ops = [];

  for (const f of fields) {
    const prior = existingByKey.get(f.key);
    if (prior) {
      kept++;
      ops.push(db.field.update({
        where: { id: prior.id },
        data: {
          type: f.type, defaultValue: f.defaultValue, label: f.label,
          section: f.section, sortOrder: f.sortOrder, orphaned: false,
        },
      }));
    } else {
      added++;
      ops.push(db.field.create({
        data: {
          pageId: existing.id, key: f.key, type: f.type, defaultValue: f.defaultValue,
          label: f.label, section: f.section, sortOrder: f.sortOrder,
        },
      }));
    }
  }
  for (const prior of existing.fields) {
    if (!incomingByKey.has(prior.key)) {
      orphaned++;
      if (!prior.orphaned) {
        ops.push(db.field.update({ where: { id: prior.id }, data: { orphaned: true } }));
      }
    }
  }

  report.merge = { kept, added, orphaned };

  ops.push(db.page.update({
    where: { id: existing.id },
    data: {
      title: requestedTitle || existing.title,
      rawSource: input.source,
      tree: JSON.parse(JSON.stringify(tree)),
      compiledCss,
      report: JSON.parse(JSON.stringify(report)),
      ...originData,
    },
  }));

  await db.$transaction(ops);
  return { report, pageId: existing.id, route: input.route, reimported: true };
}
