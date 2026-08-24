"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { imageSize } from "image-size";
import { db } from "@/lib/db";
import { TooManyAttemptsError, getSession, loginWithCredentials, logout, requireAdmin } from "@/lib/auth";
import { normalizeRoute } from "@/lib/importer/extract";
import { importPageFromSource } from "@/lib/importer/import-page";
import { bundlePageFromRepo } from "@/lib/importer/bundle";
import { getGithubToken, getRepo, getTree, setGithubToken, listRepos } from "@/lib/github";
import { pageCacheTag } from "@/lib/pages";
import { ALLOWED_IMAGE_TYPES, storage } from "@/lib/storage";
import type { ImportReport } from "@/lib/tree";

/**
 * Errors we raise ourselves carry text meant for the admin ("Route /admin is
 * reserved", "GitHub rejected the token"). Errors from the database do not:
 * their messages leak table and column names. Show the former, log the latter.
 */
function userMessage(e: unknown, fallback: string): string {
  const code = (e as { code?: unknown })?.code;
  const name = (e as { name?: unknown })?.name;
  const isDbError =
    (typeof code === "string" && /^P\d{4}$/.test(code)) ||
    (typeof name === "string" && name.startsWith("Prisma"));
  if (isDbError) {
    console.error("[action] database error", e);
    return fallback;
  }
  return e instanceof Error ? e.message : fallback;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  let session;
  try {
    session = await loginWithCredentials(email, password);
  } catch (e) {
    if (e instanceof TooManyAttemptsError) return { error: e.message };
    throw e;
  }
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
  const tailwindConfig = String(formData.get("tailwindConfig") ?? "").slice(0, 200_000);

  try {
    const outcome = await importPageFromSource({
      route,
      title: String(formData.get("title") ?? ""),
      source,
      themeCss: themeCss || undefined,
      tailwindConfig: tailwindConfig || undefined,
    });
    revalidateTag(pageCacheTag(route), "max");
    revalidatePath(route);
    revalidatePath("/admin");
    if (outcome.reimported) revalidatePath(`/admin/pages/${outcome.pageId}`);
    return {
      report: outcome.report,
      pageId: outcome.pageId,
      route,
      reimported: outcome.reimported,
    };
  } catch (e) {
    return { error: userMessage(e, "Import failed.") };
  }
}

// ---------------------------------------------------------------------------
// GitHub (Lovable projects) connection
// ---------------------------------------------------------------------------

export type ConnectState = { error?: string; ok?: boolean };

export async function connectGithubAction(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  await requireAdmin();
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { error: "Paste a GitHub personal access token." };
  try {
    await listRepos(token); // validate before storing
    await setGithubToken(token);
    revalidatePath("/admin/projects");
    return { ok: true };
  } catch (e) {
    return { error: userMessage(e, "Could not reach GitHub with that token.") };
  }
}

export async function disconnectGithubAction() {
  await requireAdmin();
  await setGithubToken(null);
  revalidatePath("/admin/projects");
}

export type GithubImportState = {
  error?: string;
  report?: ImportReport;
  pageId?: string;
  route?: string;
  reimported?: boolean;
  filesBundled?: number;
  assetsUploaded?: number;
};

export async function importFromGithubAction(
  _prev: GithubImportState,
  formData: FormData,
): Promise<GithubImportState> {
  await requireAdmin();
  const owner = String(formData.get("owner") ?? "");
  const repo = String(formData.get("repo") ?? "");
  const pagePath = String(formData.get("pagePath") ?? "");

  let route: string;
  try {
    route = normalizeRoute(String(formData.get("route") ?? ""));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid route." };
  }

  try {
    const token = await getGithubToken();
    if (!token) return { error: "GitHub is not connected." };

    const repoInfo = await getRepo(token, owner, repo);
    const branch = repoInfo.defaultBranch;
    const tree = await getTree(token, owner, repo, branch);
    const bundle = await bundlePageFromRepo({ token, owner, repo, branch }, pagePath, tree);

    const outcome = await importPageFromSource({
      route,
      source: bundle.source,
      themeCss: bundle.themeCss,
      tailwindConfig: bundle.tailwindConfig,
      indexHtml: bundle.indexHtml,
      assetUrls: bundle.assetUrls,
      truncated: bundle.truncated,
      origin: { repo: `${owner}/${repo}`, branch, path: pagePath },
    });

    revalidateTag(pageCacheTag(route), "max");
    revalidatePath(route);
    revalidatePath("/admin");
    revalidatePath(`/admin/projects/${owner}/${repo}`);
    return {
      report: outcome.report,
      pageId: outcome.pageId,
      route,
      reimported: outcome.reimported,
      filesBundled: bundle.filesBundled.length,
      assetsUploaded: bundle.assetsUploaded.length,
    };
  } catch (e) {
    return { error: userMessage(e, "GitHub import failed.") };
  }
}

/** Re-pull a GitHub-sourced page from its repo and re-import (edits survive). */
export async function syncPageAction(pageId: string): Promise<GithubImportState> {
  await requireAdmin();
  const page = await db.page.findUnique({ where: { id: pageId } });
  if (!page) return { error: "Page not found." };
  if (!page.sourceRepo || !page.sourcePath) {
    return { error: "This page was imported by paste — re-import it from the Import screen." };
  }

  try {
    const token = await getGithubToken();
    if (!token) return { error: "GitHub is not connected." };

    const [owner, repo] = page.sourceRepo.split("/");
    const repoInfo = await getRepo(token, owner, repo);
    const branch = repoInfo.defaultBranch;
    const tree = await getTree(token, owner, repo, branch);
    const bundle = await bundlePageFromRepo({ token, owner, repo, branch }, page.sourcePath, tree);

    const outcome = await importPageFromSource({
      route: page.route,
      source: bundle.source,
      themeCss: bundle.themeCss,
      tailwindConfig: bundle.tailwindConfig,
      indexHtml: bundle.indexHtml,
      assetUrls: bundle.assetUrls,
      truncated: bundle.truncated,
      origin: { repo: page.sourceRepo, branch, path: page.sourcePath },
    });

    revalidateTag(pageCacheTag(page.route), "max");
    revalidatePath(page.route);
    revalidatePath("/admin");
    revalidatePath(`/admin/pages/${pageId}`);
    return {
      report: outcome.report,
      pageId: outcome.pageId,
      route: page.route,
      reimported: outcome.reimported,
      filesBundled: bundle.filesBundled.length,
      assetsUploaded: bundle.assetsUploaded.length,
    };
  } catch (e) {
    return { error: userMessage(e, "Sync failed.") };
  }
}

// ---------------------------------------------------------------------------
// Field editing
// ---------------------------------------------------------------------------

async function revalidatePage(pageId: string) {
  const page = await db.page.findUnique({ where: { id: pageId }, select: { route: true } });
  if (page) {
    revalidateTag(pageCacheTag(page.route), "max");
    revalidatePath(page.route);
  }
}

/** Guards against a single field being used to write unbounded rows. */
const MAX_FIELD_VALUE = 100_000;

function tooLong(updates: Array<{ value: string | null }>) {
  return updates.some((u) => (u.value?.length ?? 0) > MAX_FIELD_VALUE);
}

export async function saveFieldsAction(
  pageId: string,
  updates: Array<{ id: string; value: string | null }>,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (updates.length === 0) return { ok: true };
  if (tooLong(updates)) return { ok: false, error: "One of the values is too long (100,000 characters max)." };

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
    return { ok: false, error: userMessage(e, "Save failed.") };
  }
}

/** Used by the on-page edit overlay: save by field key for a route. */
export async function saveFieldsByKeyAction(
  route: string,
  updates: Array<{ key: string; value: string }>,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (tooLong(updates)) return { ok: false, error: "One of the values is too long (100,000 characters max)." };
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
    return { ok: false, error: userMessage(e, "Save failed.") };
  }
}

// ---------------------------------------------------------------------------
// Page management
// ---------------------------------------------------------------------------

export async function setPageStatusAction(pageId: string, status: "DRAFT" | "PUBLISHED") {
  await requireAdmin();
  const page = await db.page.update({ where: { id: pageId }, data: { status } });
  revalidateTag(pageCacheTag(page.route), "max");
  revalidatePath(page.route);
  revalidatePath("/admin");
  return { ok: true };
}

export async function deletePageAction(pageId: string) {
  await requireAdmin();
  const page = await db.page.delete({ where: { id: pageId } });
  revalidateTag(pageCacheTag(page.route), "max");
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
    return { ok: false, error: userMessage(e, "Upload failed.") };
  }
}

/** How many fields currently reference this asset's URL. */
export async function assetReferenceCount(url: string) {
  // Exported from a "use server" module, so this is a callable endpoint even
  // though only admin screens use it.
  await requireAdmin();
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
