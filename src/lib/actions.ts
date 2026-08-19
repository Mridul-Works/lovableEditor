"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { imageSize } from "image-size";
import { db } from "@/lib/db";
import { getSession, loginWithCredentials, logout, requireAdmin } from "@/lib/auth";
import { extractPage, normalizeRoute } from "@/lib/importer/extract";
import { compilePageCss } from "@/lib/importer/tailwind";
import { pageCacheTag } from "@/lib/pages";
import { ALLOWED_IMAGE_TYPES, storage } from "@/lib/storage";
import type { ImportReport } from "@/lib/tree";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const session = await loginWithCredentials(email, password);
  if (!session) return { error: "Invalid email or password." };

  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/admin") ? next : "/admin");
}

export async function logoutAction() {
  await logout();
  redirect("/admin/login");
}

// ---------------------------------------------------------------------------
// Import / re-import
// ---------------------------------------------------------------------------

export type ImportState = {
  error?: string;
  report?: ImportReport;
  pageId?: string;
  route?: string;
  reimported?: boolean;
};

export async function importPageAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireAdmin();

  let source = String(formData.get("source") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    source = await file.text();
  }
  if (!source.trim()) return { error: "Paste the exported page component code (or upload the file)." };
  if (source.length > 2_000_000) return { error: "Source is too large (2MB max)." };

  let route: string;
  try {
    route = normalizeRoute(String(formData.get("route") ?? ""));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid route." };
  }

  const themeCss = String(formData.get("themeCss") ?? "").slice(0, 200_000);

  try {
    const { tree, fields, report, title } = await extractPage(source);
    const compiledCss = await compilePageCss(tree, themeCss || undefined);
    const requestedTitle = String(formData.get("title") ?? "").trim();

    const existing = await db.page.findUnique({ where: { route }, include: { fields: true } });

    if (!existing) {
      const page = await db.page.create({
        data: {
          route,
          title: requestedTitle || title,
          rawSource: source,
          tree: JSON.parse(JSON.stringify(tree)),
          compiledCss,
          report: JSON.parse(JSON.stringify(report)),
          fields: {
            create: fields.map((f) => ({
              key: f.key, type: f.type, defaultValue: f.defaultValue,
              label: f.label, section: f.section, sortOrder: f.sortOrder,
            })),
          },
        },
      });
      updateTag(pageCacheTag(route));
      revalidatePath(route);
      revalidatePath("/admin");
      return { report, pageId: page.id, route };
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
      if (!incomingByKey.has(prior.key) && !prior.orphaned) {
        orphaned++;
        ops.push(db.field.update({ where: { id: prior.id }, data: { orphaned: true } }));
      } else if (!incomingByKey.has(prior.key)) {
        orphaned++; // already orphaned, keep counting for the report
      }
    }

    report.merge = { kept, added, orphaned };

    ops.push(db.page.update({
      where: { id: existing.id },
      data: {
        title: requestedTitle || existing.title,
        rawSource: source,
        tree: JSON.parse(JSON.stringify(tree)),
        compiledCss,
        report: JSON.parse(JSON.stringify(report)),
      },
    }));

    await db.$transaction(ops);
    updateTag(pageCacheTag(route));
    revalidatePath(route);
    revalidatePath("/admin");
    revalidatePath(`/admin/pages/${existing.id}`);
    return { report, pageId: existing.id, route, reimported: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Import failed." };
  }
}

// ---------------------------------------------------------------------------
// Field editing
// ---------------------------------------------------------------------------

async function revalidatePage(pageId: string) {
  const page = await db.page.findUnique({ where: { id: pageId }, select: { route: true } });
  if (page) {
    updateTag(pageCacheTag(page.route));
    revalidatePath(page.route);
  }
}

export async function saveFieldsAction(
  pageId: string,
  updates: Array<{ id: string; value: string | null }>,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (updates.length === 0) return { ok: true };

  try {
    await db.$transaction(
      updates.map((u) =>
        db.field.update({
          where: { id: u.id, pageId },
          data: { value: u.value },
        }),
      ),
    );
    await revalidatePage(pageId);
    revalidatePath(`/admin/pages/${pageId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

/** Used by the on-page edit overlay: save by field key for a route. */
export async function saveFieldsByKeyAction(
  route: string,
  updates: Array<{ key: string; value: string }>,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const page = await db.page.findUnique({ where: { route }, select: { id: true } });
  if (!page) return { ok: false, error: "Page not found." };

  try {
    await db.$transaction(
      updates.map((u) =>
        db.field.update({
          where: { pageId_key: { pageId: page.id, key: u.key } },
          data: { value: u.value },
        }),
      ),
    );
    await revalidatePage(page.id);
    revalidatePath(`/admin/pages/${page.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

// ---------------------------------------------------------------------------
// Page management
// ---------------------------------------------------------------------------

export async function setPageStatusAction(pageId: string, status: "DRAFT" | "PUBLISHED") {
  await requireAdmin();
  const page = await db.page.update({ where: { id: pageId }, data: { status } });
  updateTag(pageCacheTag(page.route));
  revalidatePath(page.route);
  revalidatePath("/admin");
  return { ok: true };
}

export async function deletePageAction(pageId: string) {
  await requireAdmin();
  const page = await db.page.delete({ where: { id: pageId } });
  updateTag(pageCacheTag(page.route));
  revalidatePath(page.route);
  revalidatePath("/admin");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type UploadResult = {
  ok: boolean;
  error?: string;
  asset?: { id: string; url: string; filename: string; width: number | null; height: number | null };
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function uploadMediaAction(formData: FormData): Promise<UploadResult> {
  await requireAdmin();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Image is larger than 10MB." };
  if (!ALLOWED_IMAGE_TYPES[file.type]) {
    return { ok: false, error: `Unsupported type ${file.type || "unknown"} — use PNG, JPEG, WebP, GIF, AVIF or SVG.` };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let width: number | null = null;
  let height: number | null = null;
  try {
    const dim = imageSize(buffer);
    width = dim.width ?? null;
    height = dim.height ?? null;
  } catch {
    // dimensions are best-effort (e.g. some SVGs)
  }

  try {
    const stored = await storage.put(buffer, file.name, file.type);
    const asset = await db.mediaAsset.upsert({
      where: { url: stored.url },
      create: { url: stored.url, filename: file.name, width, height, size: stored.size },
      update: { filename: file.name, width, height, size: stored.size },
    });
    revalidatePath("/admin/media");
    return { ok: true, asset: { id: asset.id, url: asset.url, filename: asset.filename, width, height } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}

/** How many fields currently reference this asset's URL. */
export async function assetReferenceCount(url: string) {
  return db.field.count({
    where: { OR: [{ value: url }, { value: null, defaultValue: url }] },
  });
}

export async function deleteMediaAction(
  assetId: string,
  force = false,
): Promise<{ ok: boolean; error?: string; referenced?: number }> {
  await requireAdmin();
  const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) return { ok: true };

  const referenced = await assetReferenceCount(asset.url);
  if (referenced > 0 && !force) return { ok: false, referenced };

  await storage.delete(asset.url);
  await db.mediaAsset.delete({ where: { id: assetId } });
  revalidatePath("/admin/media");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Session probe for the edit overlay
// ---------------------------------------------------------------------------

export async function isAdminSession() {
  return (await getSession()) !== null;
}
