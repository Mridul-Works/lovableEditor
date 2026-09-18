import { test } from "node:test";
import assert from "node:assert/strict";
import { untar } from "./snapshot";

// The repo snapshot reads GitHub's branch tarball; the reader has to cope
// with the two long-path encodings git archives use, or deeply nested
// Lovable asset sidecars silently go missing.

function header(name: string, size: number, type: string, prefix = ""): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100, 8, "ascii");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  h.write(type, 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write(prefix, 345, 155, "utf8");
  return h;
}

function entry(name: string, body: string | Buffer, type = "0", prefix = ""): Buffer {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return Buffer.concat([header(name, data.length, type, prefix), padded]);
}

function pax(path: string): Buffer {
  const body = ` path=${path}\n`;
  let len = body.length;
  while (String(len).length + body.length !== len) len = String(len).length + body.length;
  return entry("PaxHeader", `${len}${body}`, "x");
}

test("untar reads regular files, prefixes, pax paths and GNU long names", () => {
  const longPax = "repo-abc/src/assets/" + "deep/".repeat(30) + "portrait.webp.asset.json";
  const longGnu = "repo-abc/src/components/" + "nested/".repeat(20) + "Card.tsx";
  const tar = Buffer.concat([
    entry("pax_global_header", "52 comment=0123456789012345678901234567890123456789\n", "g"),
    entry("repo-abc/", "", "5"),
    entry("repo-abc/package.json", '{"name":"x"}'),
    entry("index.tsx", "export default 1;", "0", "repo-abc/src/routes"),
    pax(longPax),
    entry("truncated-name", '{"url":"/a"}'),
    entry("././@LongLink", longGnu + "\0", "L"),
    entry("truncated-too", "export const Card = 1;"),
    entry("repo-abc/link", "", "2"),
    Buffer.alloc(1024),
  ]);
  const files = new Map([...untar(tar)].map((f) => [f.path, f.data.toString("utf8")]));
  assert.equal(files.get("repo-abc/package.json"), '{"name":"x"}');
  assert.equal(files.get("repo-abc/src/routes/index.tsx"), "export default 1;");
  assert.equal(files.get(longPax), '{"url":"/a"}');
  assert.equal(files.get(longGnu), "export const Card = 1;");
  assert.equal(files.size, 4, "directories, links and pax headers are not files");
});
