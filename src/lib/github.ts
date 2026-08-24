import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

// Minimal GitHub REST client. Lovable projects sync to GitHub (free plan
// included), so "connect Lovable" means connecting the GitHub account that
// Lovable pushes to. The API base is overridable via GITHUB_API_BASE for
// GitHub Enterprise or tests.

const API = () => process.env.GITHUB_API_BASE || "https://api.github.com";

export type Repo = {
  fullName: string; // owner/name
  name: string;
  owner: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  pushedAt: string;
  htmlUrl: string;
};

export class GithubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// The stored token is a GitHub PAT with read access to every connected repo,
// so it is encrypted at rest rather than sitting in the settings table in the
// clear. The key is derived from AUTH_SECRET, which already has to be secret
// and long-lived for sessions to work.
const ENC_PREFIX = "enc.v1.";

function encryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET env var must be set (16+ chars) to store a GitHub token");
  }
  return createHash("sha256").update(`github-token:${secret}`).digest();
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [ENC_PREFIX + iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function decryptToken(stored: string): string | null {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // token written before encryption existed
  // A missing or too-short AUTH_SECRET is a configuration error, not a bad
  // token: let it surface instead of silently reporting "not connected" and
  // failing later with an opaque 401 from GitHub.
  const key = encryptionKey();
  try {
    const [ivPart, tagPart, bodyPart] = stored.slice(ENC_PREFIX.length).split(".");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(bodyPart, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong or rotated AUTH_SECRET — treat as "not connected" rather than
    // handing a corrupt string to the GitHub API.
    return null;
  }
}

export async function getGithubToken(): Promise<string | null> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const row = await db.setting.findUnique({ where: { key: "github_token" } });
  return row?.value ? decryptToken(row.value) : null;
}

export async function setGithubToken(token: string | null) {
  if (process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is set in .env — remove it there to manage the token from the UI.");
  }
  if (token) {
    const value = encryptToken(token);
    await db.setting.upsert({
      where: { key: "github_token" },
      create: { key: "github_token", value },
      update: { value },
    });
  } else {
    await db.setting.deleteMany({ where: { key: "github_token" } });
  }
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "LovableEditor",
      ...init?.headers,
    },
    // GitHub content changes on push; always fetch fresh.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GithubError(
      res.status === 401
        ? "GitHub rejected the token (401). Reconnect with a valid token."
        : `GitHub API error ${res.status} on ${path}: ${body.slice(0, 200)}`,
      res.status,
    );
  }
  return res.json() as Promise<T>;
}

type RawRepo = {
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  description: string | null;
  default_branch: string;
  pushed_at: string;
  html_url: string;
};

export async function listRepos(token: string): Promise<Repo[]> {
  const repos: RawRepo[] = [];
  // 10 pages of 100 covers any realistic account; the loop still exits early.
  for (let page = 1; page <= 10; page++) {
    const batch = await gh<RawRepo[]>(
      token,
      `/user/repos?sort=pushed&per_page=100&page=${page}`,
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.map((r) => ({
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    private: r.private,
    description: r.description,
    defaultBranch: r.default_branch,
    pushedAt: r.pushed_at,
    htmlUrl: r.html_url,
  }));
}

/** Owner and repo are path segments, not free text — encode them like any other. */
function repoPath(owner: string, repo: string) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export async function getRepo(token: string, owner: string, repo: string): Promise<Repo> {
  const r = await gh<RawRepo>(token, repoPath(owner, repo));
  return {
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    private: r.private,
    description: r.description,
    defaultBranch: r.default_branch,
    pushedAt: r.pushed_at,
    htmlUrl: r.html_url,
  };
}

export type TreeEntry = { path: string; type: "blob" | "tree"; sha: string; size?: number };

export async function getTree(token: string, owner: string, repo: string, branch: string): Promise<TreeEntry[]> {
  const data = await gh<{ tree: TreeEntry[]; truncated: boolean }>(
    token,
    `${repoPath(owner, repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  if (data.truncated) {
    throw new GithubError(
      `The file tree for ${owner}/${repo} is too large for GitHub to return in full, ` +
        "so pages in the untruncated part would be silently missing.",
      422,
    );
  }
  return data.tree.filter((e) => e.type === "blob");
}

/** Text file content (UTF-8). */
export async function getFileText(
  token: string, owner: string, repo: string, path: string, ref: string,
): Promise<string> {
  const data = await gh<{ content?: string; encoding?: string }>(
    token,
    `${repoPath(owner, repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
  );
  if (data.encoding !== "base64" || data.content === undefined) {
    throw new GithubError(`Unexpected content encoding for ${path}`, 500);
  }
  return Buffer.from(data.content, "base64").toString("utf8");
}

/** Binary file content via blob sha (works for files up to ~100MB). */
export async function getBlob(token: string, owner: string, repo: string, sha: string): Promise<Buffer> {
  const data = await gh<{ content: string; encoding: string }>(
    token,
    `${repoPath(owner, repo)}/git/blobs/${encodeURIComponent(sha)}`,
  );
  // Blobs over ~100MB come back with encoding "none" and no content; decoding
  // that as base64 would silently produce garbage bytes.
  if (data.encoding !== "base64" || typeof data.content !== "string") {
    throw new GithubError(`Blob ${sha} was returned with unsupported encoding "${data.encoding}"`, 422);
  }
  return Buffer.from(data.content, "base64");
}
