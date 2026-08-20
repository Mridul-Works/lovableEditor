// Dev utility: mock GitHub REST API serving fixtures/mock-repo as the repo
// "mock/estate-site". Point the app at it with GITHUB_API_BASE=http://127.0.0.1:4599
//   npx tsx scripts/mock-github.ts
import { createServer } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "fixtures", "mock-repo");
const OWNER = "mock";
const REPO = "estate-site";
const BRANCH = "main";

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

const files = listFiles(ROOT);
const shaFor = (p: string) => Buffer.from(p).toString("hex").padEnd(40, "0").slice(0, 40);
const pathForSha = new Map(files.map((p) => [shaFor(p), p]));

const repoJson = {
  full_name: `${OWNER}/${REPO}`,
  name: REPO,
  owner: { login: OWNER },
  private: false,
  description: "Lovable project: EstateGrow landing page (mock)",
  default_branch: BRANCH,
  pushed_at: new Date().toISOString(),
  html_url: `https://github.com/${OWNER}/${REPO}`,
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = decodeURIComponent(url.pathname);
  const auth = req.headers.authorization ?? "";
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (!auth.startsWith("Bearer ") || auth === "Bearer bad") return json(401, { message: "Bad credentials" });

  if (p === "/user/repos") return json(200, [repoJson]);
  if (p === `/repos/${OWNER}/${REPO}`) return json(200, repoJson);
  if (p === `/repos/${OWNER}/${REPO}/git/trees/${BRANCH}`) {
    return json(200, {
      truncated: false,
      tree: files.map((f) => ({
        path: f, type: "blob", sha: shaFor(f), size: statSync(path.join(ROOT, f)).size,
      })),
    });
  }
  if (p.startsWith(`/repos/${OWNER}/${REPO}/contents/`)) {
    const filePath = p.slice(`/repos/${OWNER}/${REPO}/contents/`.length);
    const full = path.join(ROOT, filePath);
    try {
      const content = readFileSync(full);
      return json(200, { content: content.toString("base64"), encoding: "base64" });
    } catch {
      return json(404, { message: "Not Found" });
    }
  }
  if (p.startsWith(`/repos/${OWNER}/${REPO}/git/blobs/`)) {
    const sha = p.split("/").pop()!;
    const filePath = pathForSha.get(sha);
    if (!filePath) return json(404, { message: "Not Found" });
    const content = readFileSync(path.join(ROOT, filePath));
    return json(200, { content: content.toString("base64"), encoding: "base64" });
  }
  return json(404, { message: `No mock for ${p}` });
});

server.listen(4599, () => console.log("mock github on http://127.0.0.1:4599 —", files.length, "files"));
