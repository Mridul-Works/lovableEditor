import type { Metadata } from "next";
import "./globals.css";

// The admin UI uses the platform's own sans-serif stack rather than a Google
// font: next/font/google downloads at build time, which makes the production
// build depend on reaching fonts.googleapis.com. Imported pages are unaffected —
// they carry their own fonts in the CSS compiled at import time.

export const metadata: Metadata = {
  title: "LovableEditor",
  description: "Pages imported from Lovable, editable as a CMS.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="antialiased">
      <body>{children}</body>
    </html>
  );
}
