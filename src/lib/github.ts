import "server-only";
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

export async function getGithubToken(): Promise<string | null> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const row = await db.setting.findUnique({ where: { key: "github_token" } });
  return row?.value ?? null;
}

export async function setGithubToken(token: string | null) {
  if (process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is set in .env — remove it there to manage the token from the UI.");
  }
  if (token) {
    await db.setting.upsert({
      where: { key: "github_token" },
      create: { key: "github_token", value: token },
      update: { value: token },
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
  for (let page = 1; page <= 3; page++) {
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

export async function getRepo(token: string, owner: string, repo: string): Promise<Repo> {
  const r = await gh<RawRepo>(token, `/repos/${owner}/${repo}`);
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
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  return data.tree.filter((e) => e.type === "blob");
}

/** Text file content (UTF-8). */
export async function getFileText(
  token: string, owner: string, repo: string, path: string, ref: string,
): Promise<string> {
  const data = await gh<{ content?: string; encoding?: string }>(
    token,
    `/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
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
    `/repos/${owner}/${repo}/git/blobs/${sha}`,
  );
  return Buffer.from(data.content, data.encoding as BufferEncoding);
}
