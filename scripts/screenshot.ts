// Dev utility: screenshot a route. npx tsx scripts/screenshot.ts /demo out.png
import { chromium } from "playwright";

async function main() {
  const route = process.argv[2] ?? "/demo";
  const out = process.argv[3] ?? "demo.png";
  const browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:3000${route}`);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log(`Saved ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
