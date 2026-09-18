// Outfit stands in for Masters' Union's licensed geometric sans; Fraunces is
// the italic serif the site uses for emphasis words. Loaded at runtime from
// Google Fonts (allowed by the CSP) and only on admin surfaces — a build-time
// font download would make `next build` depend on network access, and the
// imported public pages bring their own fonts.
const HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,300;1,9..144,400&family=Outfit:wght@300;400;500;600;700&display=swap";

export function BrandFonts() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/* `precedence` lets React hoist and de-duplicate the stylesheet. */}
      <link rel="stylesheet" href={HREF} precedence="default" />
    </>
  );
}
