import "server-only";
import { createHash } from "node:crypto";
import { mkdir, writeFile, unlink, readFile, stat } from "node:fs/promises";
import path from "node:path";

// Storage abstraction. All image bytes go through this module so the backing
// store can be swapped via STORAGE_DRIVER without touching callers.
// "local" writes to UPLOADS_DIR and files are served by the /uploads/[...file]
// route handler. An S3-compatible driver plugs in by implementing
// StorageDriver and adding a case in createDriver().

export interface StoredFile {
  /** Public URL the file is reachable at (e.g. /uploads/ab12-hero.png). */
  url: string;
  filename: string;
  size: number;
}

export interface StorageDriver {
  put(buffer: Buffer, originalName: string, contentType: string): Promise<StoredFile>;
  delete(url: string): Promise<void>;
  /** Read back a stored file by its public URL. Used by the serving route. */
  read(url: string): Promise<{ buffer: Buffer; contentType: string } | null>;
}

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
};

const EXT_TO_TYPE = Object.fromEntries(
  Object.entries(ALLOWED_IMAGE_TYPES).map(([type, ext]) => [ext, type]),
);

function uploadsDir() {
  const dir = process.env.UPLOADS_DIR || "./uploads";
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

function sanitizeName(name: string) {
  const base = path.basename(name).replace(/\.[^.]*$/, "");
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "image"
  );
}

class LocalDriver implements StorageDriver {
  async put(buffer: Buffer, originalName: string, contentType: string): Promise<StoredFile> {
    const ext = ALLOWED_IMAGE_TYPES[contentType];
    if (!ext) throw new Error(`Unsupported image type: ${contentType}`);
    const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 8);
    const filename = `${hash}-${sanitizeName(originalName)}${ext}`;
    const dir = uploadsDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), buffer);
    return { url: `/uploads/${filename}`, filename, size: buffer.length };
  }

  async delete(url: string): Promise<void> {
    const file = this.resolve(url);
    if (!file) return;
    await unlink(file).catch(() => undefined);
  }

  async read(url: string) {
    const file = this.resolve(url);
    if (!file) return null;
    try {
      const info = await stat(file);
      if (!info.isFile()) return null;
      const buffer = await readFile(file);
      const contentType = EXT_TO_TYPE[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      return { buffer, contentType };
    } catch {
      return null;
    }
  }

  /** Maps /uploads/<name> to a path inside UPLOADS_DIR, rejecting traversal. */
  private resolve(url: string): string | null {
    if (!url.startsWith("/uploads/")) return null;
    const name = url.slice("/uploads/".length);
    const file = path.join(uploadsDir(), name);
    const normalized = path.normalize(file);
    if (!normalized.startsWith(path.normalize(uploadsDir() + path.sep))) return null;
    return normalized;
  }
}

function createDriver(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER || "local";
  switch (driver) {
    case "local":
      return new LocalDriver();
    // case "s3": return new S3Driver(); — implement with any S3-compatible
    // client, reading S3_ENDPOINT/S3_BUCKET/S3_KEY/S3_SECRET from env.
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${driver}" (implement it in src/lib/storage.ts)`);
  }
}

const globalForStorage = globalThis as unknown as { storage?: StorageDriver };
export const storage = globalForStorage.storage ?? (globalForStorage.storage = createDriver());
