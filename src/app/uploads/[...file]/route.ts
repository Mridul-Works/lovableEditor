import { storage } from "@/lib/storage";

// Serves uploaded images from the storage driver. Kept out of /public so
// runtime uploads work identically in dev, next start, and containerized
// deploys (public/ is only guaranteed at build time).

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string[] }> },
) {
  const { file } = await params;
  const result = await storage.read(`/uploads/${file.join("/")}`);
  if (!result) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": result.contentType,
      // Filenames are content-hashed, so long-lived caching is safe.
      "Cache-Control": "public, max-age=31536000, immutable",
      // An SVG is a document: opened directly it can run script on this origin.
      // The sandbox plus a null default-src neutralises that while leaving the
      // file perfectly usable as an <img> source.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
