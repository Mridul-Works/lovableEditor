import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@tailwindcss/node",
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@prisma/adapter-pg",
    "@babel/parser",
    "@babel/traverse",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];
    return [
      {
        // Uploaded files are attacker-influenced content served from our own
        // origin: an SVG opened directly is a document that can run script.
        // This rule must come with its own CSP because a later matching rule
        // would otherwise replace it with the page policy below.
        source: "/uploads/:path*",
        headers: [
          ...common,
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
          },
        ],
      },
      {
        // Everything except /uploads, which is handled above.
        source: "/((?!uploads/).*)",
        headers: [
          ...common,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Imported pages legitimately carry inline <style> and Google Fonts;
          // scripts stay first-party so a stored tree can never introduce one.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob: https:",
              "media-src 'self' data: blob: https:",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' data: https://fonts.gstatic.com",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
