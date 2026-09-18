import "server-only";
import { gunzipSync } from "node:zlib";
import {
  downloadTarball,
  getBlob,
  getBranchHead,
  getFileText,
  getRepo,
  getTree,
  type TreeEntry,
} from "@/lib/github";

// Reading a Lovable repo. Importing one page touches ~60 source files and up
// to several hundred asset sidecars; fetched one by one that is hundreds of
// GitHub API calls per page, and a whole-project sync (dozens of pages) would
// burn through the hourly rate limit. A snapshot downloads the branch tarball
// once — a single API call — and serves every read from memory. It is cached
// by commit, so the pages of one project sync share it and a new push is
// picked up on the next import.

export interface RepoReader {
  /** UTF-8 text of a file in the repo. */
  text(path: string): Promise<string>;
  /** Raw bytes of a file in the repo. */
  bytes(entry: TreeEntry): Promise<Buffer>;
  /** "snapshot" when served from a downloaded tarball, "api" for per-file fetches. */
  readonly kind: "snapshot" | "api";
}

export type RepoContext = {
  owner: string;
  repo: string;
  branch: string;
  /** Commit the tree and reader correspond to. */
  commit: string;
  tree: TreeEntry[];
  reader: RepoReader;
};

const MAX_TARBALL_BYTES = 250 * 1024 * 1024;
const CACHE_TTL_MS = 20 * 60_000;

type CacheEntry = { at: number; context: Promise<RepoContext> };
const globalForSnapshots = globalThis as unknown as { repoSnapshots?: Map<string, CacheEntry> };
const cache = globalForSnapshots.repoSnapshots ?? (globalForSnapshots.repoSnapshots = new Map());

/**
 * Everything needed to import pages from a repo at its current head. Costs two
 * small API calls (default branch + head commit) when the snapshot is cached.
 */
export async function getRepoContext(token: string, owner: string, repo: string): Promise<RepoContext> {
  const info = await getRepo(token, owner, repo);
  const branch = info.defaultBranch;
  const commit = await getBranchHead(token, owner, repo, branch);
  const key = `${owner}/${repo}@${commit}`;

  for (const [k, entry] of cache) {
    if (Date.now() - entry.at > CACHE_TTL_MS) cache.delete(k);
  }
  const hit = cache.get(key);
  if (hit) return hit.context;

  const context = (async (): Promise<RepoContext> => {
    const tree = await getTree(token, owner, repo, commit);
    const reader = await snapshotReader(token, owner, repo, commit).catch(() => apiReader(token, owner, repo, commit));
    return { owner, repo, branch, commit, tree, reader };
  })();
  cache.set(key, { at: Date.now(), context });
  // A failed load must not poison the cache for the next attempt.
  context.catch(() => cache.delete(key));
  return context;
}

/** Per-file reads through the GitHub contents/blobs API. Always available. */
export function apiReader(token: string, owner: string, repo: string, ref: string): RepoReader {
  return {
    kind: "api",
    text: (path) => getFileText(token, owner, repo, path, ref),
    bytes: (entry) => getBlob(token, owner, repo, entry.sha),
  };
}

async function snapshotReader(token: string, owner: string, repo: string, ref: string): Promise<RepoReader> {
  const gz = await downloadTarball(token, owner, repo, ref, MAX_TARBALL_BYTES);
  const files = new Map<string, Buffer>();
  for (const file of untar(gunzipSync(gz))) {
    // GitHub wraps the tree in one top-level "<owner>-<repo>-<sha>/" folder.
    const slash = file.path.indexOf("/");
    if (slash >= 0) files.set(file.path.slice(slash + 1), file.data);
  }
  if (files.size === 0) throw new Error("Empty repository archive");

  const fallback = apiReader(token, owner, repo, ref);
  return {
    kind: "snapshot",
    async text(path) {
      const data = files.get(path);
      return data ? data.toString("utf8") : fallback.text(path);
    },
    async bytes(entry) {
      return files.get(entry.path) ?? fallback.bytes(entry);
    },
  };
}

function field(header: Buffer, start: number, length: number): string {
  const slice = header.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? length : end).toString("utf8");
}

/**
 * Minimal tar reader: regular files only, with the two long-path schemes git
 * archives use (pax `x` records and GNU `L` entries). Everything else —
 * directories, links, the pax global header — is skipped.
 */
export function* untar(buf: Buffer): Generator<{ path: string; data: Buffer }> {
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    const name = field(header, 0, 100);
    const size = parseInt(field(header, 124, 12).trim() || "0", 8) || 0;
    const type = String.fromCharCode(header[156] || 48); // "\0" is an old-style regular file
    const prefix = field(header, 345, 155);
    const dataStart = offset + 512;
    const data = buf.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = data.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    if (type === "x") {
      // Records look like "<len> key=value\n"; only `path` matters here.
      // <len> counts the whole record in bytes, so walk the buffer, not a string.
      let at = 0;
      while (at < data.length) {
        const space = data.indexOf(0x20, at);
        if (space < 0) break;
        const len = Number(data.subarray(at, space).toString("ascii"));
        if (!Number.isFinite(len) || len <= 0) break;
        const record = data.subarray(space + 1, at + len).toString("utf8");
        const eq = record.indexOf("=");
        if (eq > 0 && record.slice(0, eq) === "path") paxPath = record.slice(eq + 1).replace(/\n$/, "");
        at += len;
      }
      continue;
    }
    if (type === "g") continue;

    const path: string = paxPath ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    longName = null;
    if (type === "0") yield { path, data: Buffer.from(data) };
  }
}
